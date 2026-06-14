import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1.vector import Vector
from pydantic import BaseModel, Field

from config import settings
from routers.ingest import _enforce_cost_caps
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import add_user_category, firestore_safe, get_db, get_user_categories
from services.gemini import match_existing, normalize_slug

router = APIRouter(tags=["notes"])


class NoteUpdate(BaseModel):
    """Owner-editable fields. Both optional — send only what changes."""
    user_note: str | None = None
    content_type: str | None = None


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
    await db.collection("notes").document(note_id).delete()
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

    if body.content_type is not None:
        # Normalise + collapse to an existing category so the list doesn't fragment
        # (e.g. "Recipes" → existing "recipe"), then register it so it shows in the
        # filter chips and the classifier can prefer it for future saves.
        slug = match_existing(normalize_slug(body.content_type), await get_user_categories(user_id))
        await ref.update({"content_type": slug, "updated_at": datetime.now(timezone.utc)})
        await add_user_category(user_id, slug)

    if body.user_note is not None:
        await db.collection("annotations").document(note_id).set(
            {"user_id": user_id, "note_id": note_id, "user_note": body.user_note,
             "updated_at": datetime.now(timezone.utc)},
            merge=True,
        )

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
    await add_user_category(user_id, slug)
    return {"id": note_id}


@router.post("/notes/{note_id}/share")
async def share_note(note_id: str, user_id: str = Depends(require_user)):
    """Make a note publicly readable and return its shareable link. Notes are written
    only by the backend (Firestore rules forbid client writes), so this lives here."""
    db = get_db()
    ref = await _owned_note_ref(db, note_id, user_id)
    await ref.update({"is_public": True, "updated_at": datetime.now(timezone.utc)})
    return {"is_public": True, "url": f"{settings.PUBLIC_APP_URL}/p/{note_id}"}


@router.delete("/notes/{note_id}/share")
async def unshare_note(note_id: str, user_id: str = Depends(require_user)):
    """Revoke public access — the /p/{id} link stops resolving."""
    db = get_db()
    ref = await _owned_note_ref(db, note_id, user_id)
    await ref.update({"is_public": False, "updated_at": datetime.now(timezone.utc)})
    return {"is_public": False}
