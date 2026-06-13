from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import settings
from services.auth_dep import require_user
from services.firebase import add_user_category, get_db, get_user_categories
from services.gemini import match_existing, normalize_slug

router = APIRouter(tags=["notes"])


class NoteUpdate(BaseModel):
    """Owner-editable fields. Both optional — send only what changes."""
    user_note: str | None = None
    content_type: str | None = None


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
