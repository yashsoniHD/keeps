from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1.vector import Vector
from pydantic import BaseModel, Field

from models.note import IngestRequest
from routers.ingest import _create_job
from services.auth_dep import require_user
from services.embeddings import EMBED_TEXT_VERSION, embedding_service, note_embedding_text
from services.firebase import (
    add_user_category,
    firestore_safe,
    get_db,
    get_user_categories,
    prune_category_if_empty,
)
from services.gemini import match_existing, normalize_slug

router = APIRouter(tags=["notes"])


class NoteUpdate(BaseModel):
    """Owner-editable fields. All optional — send only what changes."""
    content_type: str | None = None
    title: str | None = Field(default=None, max_length=300)
    ai_summary: str | None = Field(default=None, max_length=2000)
    data: dict[str, Any] | None = None  # body/structured fields


async def _note_embedding(title: str, ai_summary: str,
                          data: dict | None = None) -> Vector | None:
    """Embed a note (title + summary + flattened data) for semantic search; non-fatal (the note
    is written either way)."""
    text = note_embedding_text(title, ai_summary, data)
    if not text:
        return None
    try:
        vec = await embedding_service.embed_document(text)
        return Vector(vec) if vec else None
    except Exception:
        return None


async def _owned_note_ref(db, note_id: str, user_id: str):
    """Resolve a note the caller owns, or raise 404. Owner-only guard."""
    ref = db.collection("notes").document(note_id)
    snap = await ref.get()
    if not snap.exists or (snap.to_dict() or {}).get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    return ref


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user_id: str = Depends(require_user)):
    db = get_db()
    doc = await db.collection("notes").document(note_id).get()
    if not doc.exists or doc.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    content_type = (doc.to_dict() or {}).get("content_type")
    await db.collection("notes").document(note_id).delete()
    # Auto-remove the category if that was its last note (a no-op otherwise). Placeholder
    # categories the user added but never filled are untouched — nothing ever leaves them.
    await prune_category_if_empty(user_id, content_type)
    return {"status": "deleted"}


@router.patch("/notes/{note_id}")
async def update_note(note_id: str, body: NoteUpdate, user_id: str = Depends(require_user)):
    """Owner edits to a note: title/summary/data and/or `content_type` recategorisation.
    Writes go through the backend (Firestore rules forbid client writes)."""
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
    if updates:
        updates["updated_at"] = datetime.now(timezone.utc)
        await ref.update(updates)
        # The search vector is built from title + summary + flattened data, so a rename/summary
        # OR body edit must refresh it or semantic search drifts. Best-effort — note already saved.
        if {"title", "ai_summary", "data"} & set(updates):
            cur = (await ref.get()).to_dict() or {}
            vec = await _note_embedding(cur.get("title", ""), cur.get("ai_summary", ""),
                                        cur.get("data"))
            if vec is not None:
                await ref.update({"embedding": vec, "embedding_version": EMBED_TEXT_VERSION})

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

    return {"ok": True}


@router.post("/notes/{note_id}/reextract")
async def reextract_note(note_id: str, user_id: str = Depends(require_user)):
    """Re-run the full extraction pipeline over a note's original source_url and overwrite the
    note in place (its created_at is preserved). Heals notes captured before an extraction fix
    (e.g. a listicle whose later venues came back bare) and is the real "Retry" behind salvage
    bookmarks. Owner-only; counts against the per-user daily ingest cap. A now-dead source fails
    the job WITHOUT clobbering the existing note (guarded in the worker).

    Returns {job_id} so the client can watch the job doc and refresh the note in place."""
    db = get_db()
    snap = await db.collection("notes").document(note_id).get()
    note = snap.to_dict() if snap.exists else None
    if not note:
        raise HTTPException(404, "Note not found")
    if note.get("user_id") != user_id:
        raise HTTPException(403, "Not your note")
    source_url = note.get("source_url") or ""
    if not source_url.startswith(("http://", "https://")):
        # Typed/uploaded/AI notes have no web source to re-fetch.
        raise HTTPException(400, "This note has no source URL to re-extract from.")
    body = IngestRequest(input_type="url", url=source_url, source=note.get("source") or "web")
    job = await _create_job(db, user_id, body, target_note_id=note_id)
    return {"job_id": job.job_id}
