"""Smart-collection endpoints.

Collections are created + styled directly by the client (Firestore rules allow owner writes to
`collections/{id}` for name/description/icon/palette/updated_at — see infra/firestore.rules).
The backend owns everything that touches NOTE membership, because notes are backend-write-only:

- `POST .../rescore`: (re)compute embedding-matched membership across the user's whole corpus.
  Rate-capped per collection per day (MAX_RESCORES_PER_COLLECTION_PER_DAY) and gated by
  MAX_COLLECTIONS_PER_USER — collections are client-created directly in Firestore, so this
  endpoint is the one enforcement boundary for both caps.
- `POST/DELETE .../notes/{note_id}`: pin/exclude — hard overrides that survive rescoring.
- `DELETE /collections/{id}`: strips the collection id from every member note (best-effort sweep)
  before deleting the collection doc. The client's own `deleteCollection()` (a bare Firestore
  `deleteDoc`) does NOT do this sweep — the frontend calls this endpoint first and only falls
  back to the bare client delete if the request fails, so the folder still goes away either way.
"""
from fastapi import APIRouter, Depends, HTTPException

from config import settings
from services.auth_dep import require_user
from services.collections import (
    add_exclusion,
    add_pin,
    rescore_collection,
    strip_collection_from_notes,
)
from services.firebase import get_db, get_user_collections, reserve_collection_rescore

router = APIRouter(tags=["collections"])


async def _owned_collection(db, collection_id: str, user_id: str) -> dict:
    """Resolve a collection the caller owns, or 404 (never reveal another user's id exists)."""
    snap = await db.collection("collections").document(collection_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("user_id") != user_id:
        raise HTTPException(404, "Collection not found")
    return d


async def _owned_note(db, note_id: str, user_id: str) -> dict:
    """Resolve a note the caller owns, or 404."""
    snap = await db.collection("notes").document(note_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    return d


async def _rescore(collection_id: str, user_id: str) -> dict:
    """Shared handler behind /rescore."""
    db = get_db()
    d = await _owned_collection(db, collection_id, user_id)
    # Collections are created directly by the client in Firestore (no backend create path), so
    # this API call is the one enforcement boundary for the cap on how many a user can have.
    collections = await get_user_collections(user_id)
    if len(collections) > settings.MAX_COLLECTIONS_PER_USER:
        raise HTTPException(
            400, f"You have more than {settings.MAX_COLLECTIONS_PER_USER} collections — "
                 "delete some before rescoring.")
    if not await reserve_collection_rescore(user_id, collection_id):
        raise HTTPException(
            429, "Rescore limit reached for this collection today — try again tomorrow.")
    return await rescore_collection(
        db, user_id, collection_id, d.get("name", ""), d.get("description") or "",
        collection_data=d)


@router.post("/collections/{collection_id}/rescore")
async def rescore(collection_id: str, user_id: str = Depends(require_user)):
    """(Re)score this collection's membership across the user's whole corpus — matches by
    embedding similarity, respecting pinned/excluded overrides. Owner-checked; capped
    (MAX_RESCORES_PER_COLLECTION_PER_DAY) and gated by MAX_COLLECTIONS_PER_USER. Idempotent."""
    return await _rescore(collection_id, user_id)


@router.post("/collections/{collection_id}/notes/{note_id}")
async def pin_note(collection_id: str, note_id: str, user_id: str = Depends(require_user)):
    """Pin: manually add a note to a collection, overriding the embedding matcher — it stays in
    even if a later rescore's cosine similarity says otherwise. Owner-checked on both docs."""
    db = get_db()
    await _owned_collection(db, collection_id, user_id)
    await _owned_note(db, note_id, user_id)
    await add_pin(db, collection_id, note_id)
    return {"ok": True}


@router.delete("/collections/{collection_id}/notes/{note_id}")
async def exclude_note(collection_id: str, note_id: str, user_id: str = Depends(require_user)):
    """Manual remove: exclude a note from a collection, overriding the embedding matcher — it
    stays out even if it becomes a strong match again on a later rescore. Owner-checked."""
    db = get_db()
    await _owned_collection(db, collection_id, user_id)
    await _owned_note(db, note_id, user_id)
    await add_exclusion(db, collection_id, note_id)
    return {"ok": True}


@router.delete("/collections/{collection_id}")
async def delete_collection(collection_id: str, user_id: str = Depends(require_user)):
    """Delete sweep: strip this collection id from every member note's `collection_ids` (best-
    effort, batched-by-stream) before deleting the collection doc itself. Owner-checked."""
    db = get_db()
    await _owned_collection(db, collection_id, user_id)
    stripped = await strip_collection_from_notes(db, user_id, collection_id)
    await db.collection("collections").document(collection_id).delete()
    return {"ok": True, "stripped": stripped}
