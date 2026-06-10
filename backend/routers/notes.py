from fastapi import APIRouter, Depends, HTTPException

from services.auth_dep import require_user
from services.firebase import get_db

router = APIRouter(tags=["notes"])


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


@router.delete("/notes")
async def delete_all_notes(user_id: str = Depends(require_user)):
    """Clears all notes for the authenticated user (settings 'danger zone')."""
    db = get_db()
    batch = db.batch()
    count = 0
    async for doc in db.collection("notes").where("user_id", "==", user_id).stream():
        batch.delete(doc.reference)
        count += 1
        if count % 400 == 0:
            await batch.commit()
            batch = db.batch()
    await batch.commit()  # committing an empty batch is a no-op
    return {"deleted": count}
