import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1.vector import Vector
from pydantic import BaseModel, Field

from config import settings
from routers.ingest import _enforce_cost_caps
from services import search_index
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import (
    add_user_category,
    firestore_safe,
    get_db,
    get_user_categories,
    get_user_collections,
    prune_category_if_empty,
)
from services.gemini import match_existing, normalize_slug
from services.item_reconcile import reconcile_note_items

router = APIRouter(tags=["notes"])


class NoteUpdate(BaseModel):
    """Owner-editable fields. All optional — send only what changes."""
    user_note: str | None = None
    content_type: str | None = None
    title: str | None = Field(default=None, max_length=300)
    is_favorite: bool | None = None   # star a note for quick access in the Library
    pinned: bool | None = None        # float to the top of the feed (sets/clears pinned_at)
    ai_summary: str | None = Field(default=None, max_length=2000)
    data: dict[str, Any] | None = None  # body/structured fields (e.g. {"body": "…"} on a typed note)
    # Move to a smart bucket (its id) or the Notes catch-all (null). Uses model_fields_set to tell
    # "sent as null" from "omitted", so a PATCH that doesn't touch it leaves membership alone.
    collection_id: str | None = None


class AugmentNoteIn(BaseModel):
    """"Add to this note" from Ask AI: COMPOSER `data` blocks to additively merge into an
    existing note (e.g. a "Where to stay" section appended to an itinerary)."""
    data: dict[str, Any] = Field(default_factory=dict)
    source_note_ids: list[str] = Field(default_factory=list, max_length=50)


def _merge_blocks(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Additive merge of COMPOSER blocks — append, never overwrite. List blocks
    (sections/steps/checklist/facts/quotes) are extended; a `table` with identical columns
    gains rows, otherwise the incoming table is kept under a free key; unknown keys are added
    only if absent. Existing content is preserved so an AI edit can't clobber the user's note."""
    merged = dict(existing or {})
    for key, val in (incoming or {}).items():
        cur = merged.get(key)
        if cur is None:
            merged[key] = val
        elif isinstance(cur, list) and isinstance(val, list):
            merged[key] = cur + val
        elif isinstance(cur, dict) and isinstance(val, dict) and key == "table":
            if cur.get("columns") == val.get("columns"):
                merged[key] = {**cur, "rows": (cur.get("rows") or []) + (val.get("rows") or [])}
            else:
                merged[f"{key}_added"] = val
        # else: scalar/incompatible — keep the user's existing value untouched.
    return merged


class ConsolidatedNoteIn(BaseModel):
    """An AI-built note saved from Ask AI chat: a consolidation across notes (Phase 2)
    or a freshly authored note (Phase 4)."""
    title: str = Field(min_length=1, max_length=300)
    ai_summary: str = Field(default="", max_length=2000)
    content_type: str = Field(default="summary", max_length=60)
    data: dict[str, Any] = Field(default_factory=dict)
    source_note_ids: list[str] = Field(default_factory=list, max_length=50)
    origin: str = "consolidated"   # "consolidated" | "created" → note provenance


async def _note_embedding(title: str, ai_summary: str) -> Vector | None:
    """Embed a note for semantic search; non-fatal (the note is written either way)."""
    text = "\n".join(p for p in (title, ai_summary) if p).strip()
    if not text:
        return None
    try:
        vec = await embedding_service.embed_document(text)
        return Vector(vec) if vec else None
    except Exception:
        return None


async def _owned_note_ref(db, note_id: str, user_id: str):
    """Resolve a note the caller owns, or raise 404. Shared by share/unshare."""
    ref = db.collection("notes").document(note_id)
    snap = await ref.get()
    if not snap.exists or (snap.to_dict() or {}).get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    return ref


@router.get("/notes")
async def list_notes(user_id: str = Depends(require_user)):
    db = get_db()
    query = (db.collection("notes").where("user_id", "==", user_id)
             .order_by("created_at", direction="DESCENDING"))
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


@router.get("/notes/{note_id}")
async def get_note(note_id: str, user_id: str = Depends(require_user)):
    doc = await get_db().collection("notes").document(note_id).get()
    if not doc.exists or doc.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    return {"id": doc.id, **doc.to_dict()}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user_id: str = Depends(require_user)):
    db = get_db()
    doc = await db.collection("notes").document(note_id).get()
    if not doc.exists or doc.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    content_type = (doc.to_dict() or {}).get("content_type")
    await db.collection("notes").document(note_id).delete()
    await search_index.remove(db, "note", note_id)  # keep search/Clip AI free of ghosts
    # Auto-remove the category if that was its last note (a no-op otherwise). Placeholder
    # categories the user added but never filled are untouched — nothing ever leaves them.
    await prune_category_if_empty(user_id, content_type)
    return {"status": "deleted"}


@router.patch("/notes/{note_id}")
async def update_note(note_id: str, body: NoteUpdate, user_id: str = Depends(require_user)):
    """Owner edits to a note: a private `user_note` annotation and/or `content_type`
    recategorisation. Writes go through the backend (Firestore rules forbid client writes).

    Privacy: `user_note` is stored in a SEPARATE owner-only `annotations/{note_id}` doc,
    never on the note itself — a note can be made public (`/p/{id}`, world-readable doc),
    and Firestore has no field-level security, so private thoughts must not live on it."""
    db = get_db()
    ref = await _owned_note_ref(db, note_id, user_id)  # 404s if not owner

    # Title / summary / body edits are applied together so a body edit that also refreshes
    # the excerpt re-embeds only once.
    updates: dict[str, Any] = {}
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(422, "Title cannot be empty.")
        updates["title"] = title
    if body.ai_summary is not None:
        updates["ai_summary"] = body.ai_summary.strip()
    if body.data is not None:
        updates["data"] = firestore_safe(body.data)
    if body.is_favorite is not None:
        updates["is_favorite"] = bool(body.is_favorite)
    if body.pinned is not None:
        # pinned_at doubles as the flag and the sort key (newest-pinned-first); clearing
        # the pin nulls it so the feed/Library can treat absent-or-null as "not pinned".
        updates["pinned_at"] = datetime.now(timezone.utc) if body.pinned else None
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc)
        await ref.update(updates)
        # The search vector is built from title + ai_summary, so a rename/summary edit must
        # refresh it or semantic search drifts. Best-effort — the note is already saved.
        if "title" in updates or "ai_summary" in updates:
            cur = (await ref.get()).to_dict() or {}
            vec = await _note_embedding(cur.get("title", ""), cur.get("ai_summary", ""))
            if vec is not None:
                await ref.update({"embedding": vec})

    if body.content_type is not None:
        # Normalise + collapse to an existing category so the list doesn't fragment
        # (e.g. "Recipes" → existing "recipe"), then register it so it shows in the
        # filter chips and the classifier can prefer it for future saves.
        slug = match_existing(normalize_slug(body.content_type), await get_user_categories(user_id))
        old_ct = (((await ref.get()).to_dict()) or {}).get("content_type")
        await ref.update({"content_type": slug, "updated_at": datetime.now(timezone.utc)})
        await add_user_category(user_id, slug)
        # If this note was the last of its previous type, retire that now-empty category.
        if old_ct and old_ct != slug:
            await prune_category_if_empty(user_id, old_ct)
        # Reconcile the mini-app item docs: a note recategorised out of a family (e.g. product →
        # software) must drop its now-orphaned items, and one moved into a family gets fanned out.
        # Best-effort — a reconciliation failure must never fail the category change.
        if old_ct != slug:
            await reconcile_note_items(user_id, note_id, old_ct, slug)

    # Move to a smart bucket (or the catch-all). "sent" is distinguished from "omitted" so a PATCH
    # that never mentions collection_id doesn't clobber membership.
    if "collection_id" in body.model_fields_set:
        cid = body.collection_id
        if cid is not None:
            valid = {c["id"] for c in await get_user_collections(user_id)}
            if cid not in valid:
                raise HTTPException(404, "Collection not found")
        await ref.update({"collection_id": cid, "updated_at": datetime.now(timezone.utc)})

    if body.user_note is not None:
        await db.collection("annotations").document(note_id).set(
            {"user_id": user_id, "note_id": note_id, "user_note": body.user_note,
             "updated_at": datetime.now(timezone.utc)},
            merge=True,
        )

    # Re-sync the search index if anything it mirrors (title/summary/collection) changed.
    if ({"title", "ai_summary"} & body.model_fields_set) or body.content_type is not None \
            or "collection_id" in body.model_fields_set:
        cur = (await ref.get()).to_dict() or {}
        await search_index.upsert_for_note(db, note_id, cur, cur.get("embedding"))

    return {"ok": True}


@router.post("/notes/consolidated")
async def create_consolidated_note(body: ConsolidatedNoteIn, user_id: str = Depends(require_user)):
    """Persist an Ask-AI-built artifact (itinerary/meal plan/comparison/…) as a note.
    `template="composed"` forces the GenericNote block renderer (the data is COMPOSER
    blocks, not a fixed template schema), and provenance marks it AI-consolidated."""
    db = get_db()
    await _enforce_cost_caps(db, user_id)  # same per-user/global note caps as ingest

    slug = match_existing(normalize_slug(body.content_type), await get_user_categories(user_id))
    acquisition = "ai_created" if body.origin == "created" else "ai_consolidated"
    note_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    note_doc = {
        "user_id": user_id,
        "content_type": slug,
        "template": "composed",         # render via GenericNote blocks, never a fixed template
        "title": body.title,
        "ai_summary": body.ai_summary,
        "source_url": "",
        "source_domain": "",
        "source": "ai",
        "cover_image_url": None,
        "data": firestore_safe(body.data),
        "acquisition": acquisition,
        "source_note_ids": body.source_note_ids[:50],
        "created_at": now,
        "updated_at": now,
    }
    embedding = await _note_embedding(body.title, body.ai_summary)
    if embedding is not None:
        note_doc["embedding"] = embedding
    await db.collection("notes").document(note_id).set(note_doc)
    await search_index.upsert_for_note(db, note_id, note_doc, embedding)
    await add_user_category(user_id, slug)
    return {"id": note_id}


@router.post("/notes/{note_id}/augment")
async def augment_note(note_id: str, body: AugmentNoteIn, user_id: str = Depends(require_user)):
    """Additively merge AI-built blocks into an existing note's `data` (the "Add to {note}"
    action). Ownership-checked; never overwrites existing content. Records provenance."""
    db = get_db()
    ref = await _owned_note_ref(db, note_id, user_id)  # 404s if not owner
    snap = await ref.get()
    current = snap.to_dict() or {}
    merged = _merge_blocks(current.get("data") or {}, body.data)
    prior_sources = current.get("source_note_ids") or []
    sources = list(dict.fromkeys([*prior_sources, *body.source_note_ids]))[:50]
    await ref.update({
        "data": firestore_safe(merged),
        "source_note_ids": sources,
        "updated_at": datetime.now(timezone.utc),
    })
    return {"ok": True, "id": note_id}


@router.post("/notes/{note_id}/share")
async def share_note(note_id: str, user_id: str = Depends(require_user)):
    """Make a note publicly readable and return its shareable link. Notes are written
    only by the backend (Firestore rules forbid client writes), so this lives here."""
    db = get_db()
    ref = await _owned_note_ref(db, note_id, user_id)
    await ref.update({"is_public": True, "updated_at": datetime.now(timezone.utc)})
    return {"is_public": True, "url": f"{settings.PUBLIC_APP_URL}/p/{note_id}"}


@router.post("/notes/{note_id}/save")
async def save_shared_note(note_id: str, user_id: str = Depends(require_user)):
    """Copy a publicly-shared note into the caller's own account — the receiver of a
    /p/{id} link saving it to their Clipnote. We duplicate the already-structured `data`
    under a new id the caller owns (no AI re-run, so it's cheap), but still count it
    against the per-user/global note caps. Saving your own note (or re-opening one already
    saved) is a no-op that returns the existing id."""
    db = get_db()
    snap = await db.collection("notes").document(note_id).get()
    src = snap.to_dict() if snap.exists else None
    # Only public notes are copyable; anything else looks "not found" (never reveal a
    # private id exists), mirroring the /p/{id} read rule.
    if not src or src.get("is_public") is not True:
        raise HTTPException(404, "Note not found")
    if src.get("user_id") == user_id:
        return {"id": note_id}  # already yours — just open it

    await _enforce_cost_caps(db, user_id)

    template = src.get("template") or src.get("content_type") or "summary"
    slug = match_existing(normalize_slug(src.get("content_type", "summary")),
                          await get_user_categories(user_id))
    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    note_doc = {
        "user_id": user_id,
        "content_type": slug,
        "template": template,          # preserve the structural schema the data was built for
        "title": src.get("title", "Saved note"),
        "ai_summary": src.get("ai_summary", ""),
        "source_url": src.get("source_url", ""),
        "source_domain": src.get("source_domain", ""),
        "source": "shared",            # provenance: arrived via a shared link
        "cover_image_url": src.get("cover_image_url"),
        "data": firestore_safe(src.get("data", {})),
        "acquisition": "saved_shared",
        "source_note_ids": [note_id],
        "is_public": False,            # the copy is private until its new owner shares it
        "created_at": now,
        "updated_at": now,
    }
    embedding = await _note_embedding(note_doc["title"], note_doc["ai_summary"])
    if embedding is not None:
        note_doc["embedding"] = embedding
    await db.collection("notes").document(new_id).set(note_doc)
    await search_index.upsert_for_note(db, new_id, note_doc, embedding)
    await add_user_category(user_id, slug)
    return {"id": new_id}


@router.delete("/notes/{note_id}/share")
async def unshare_note(note_id: str, user_id: str = Depends(require_user)):
    """Revoke public access — the /p/{id} link stops resolving."""
    db = get_db()
    ref = await _owned_note_ref(db, note_id, user_id)
    await ref.update({"is_public": False, "updated_at": datetime.now(timezone.utc)})
    return {"is_public": False}
