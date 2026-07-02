"""Smart-collection backfill endpoint.

Collections are created + styled directly by the client (Firestore rules allow owner writes to
`collections/{id}`). The one thing the client can't do is (re)file notes, because notes are
backend-write-only. So when a user creates a collection over an existing corpus, the client calls
this endpoint to sweep matching, currently-unassigned notes into it (embedding match, single-home).
"""
from fastapi import APIRouter, Depends, HTTPException

from services.auth_dep import require_user
from services.collections import assign_unassigned_to_collection
from services.firebase import get_db

router = APIRouter(tags=["collections"])


@router.post("/collections/{collection_id}/backfill")
async def backfill_collection(collection_id: str, user_id: str = Depends(require_user)):
    """Assign the user's existing, unassigned notes that match this collection into it. Reads the
    collection's name/description (owner-checked) and runs an embedding-based sweep. Idempotent."""
    db = get_db()
    snap = await db.collection("collections").document(collection_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("user_id") != user_id:
        raise HTTPException(404, "Collection not found")
    return await assign_unassigned_to_collection(
        db, user_id, collection_id, d.get("name", ""), d.get("description") or "")
