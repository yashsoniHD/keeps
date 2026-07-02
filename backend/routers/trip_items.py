"""Trips mini-app: owner edits to per-trip trip_items.

Items live at users/{uid}/trip_items/{id}. Firestore rules make the subcollection client-readable
but not client-writable (like recipe_items), so every state change goes through these backend
endpoints, keeping the worker-written enrichment fields (days, stops, geocoded coords, image) safe
from client tampering.

Trips have no status workflow (no saved/planned/been buckets) — the wall is one searchable list
organised by filters + favorites — so the only owner-editable field is `favorite`. As with the
recipes app, a trip is "added" simply by ingesting its URL through the normal /api/ingest flow,
which creates an itinerary note that fans out into a trip_item. So this router only covers the
favorite toggle, delete, and backfill.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services import search_index
from services.auth_dep import require_user
from services.firebase import get_db
from services.itineraries import backfill_user

router = APIRouter(tags=["trip_items"])


class TripItemUpdate(BaseModel):
    """Owner-editable state on a trip item. Trips have no status buckets, so the only mutable
    field is the favorite star."""
    favorite: bool | None = None


def _item_ref(db, uid: str, item_id: str):
    return db.collection("users").document(uid).collection("trip_items").document(item_id)


@router.patch("/trip-items/{item_id}")
async def update_trip_item(item_id: str, body: TripItemUpdate,
                           user_id: str = Depends(require_user)):
    """Toggle the favorite star on a trip."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Trip item not found.")

    updates: dict = {"updated_at": datetime.now(timezone.utc)}
    if body.favorite is not None:
        updates["favorite"] = body.favorite
    await ref.update(updates)
    return {"ok": True}


@router.post("/trip-items/backfill")
async def backfill_trip_items(user_id: str = Depends(require_user)):
    """Import trips from the user's existing itinerary notes into the wall. Reads each note's
    already-structured `data` (no re-scraping, no Gemini; only cached stop geocodes). Safe to
    re-run (idempotent)."""
    return await backfill_user(user_id)


@router.delete("/trip-items/{item_id}")
async def delete_trip_item(item_id: str, user_id: str = Depends(require_user)):
    """Remove a trip from the user's wall."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Trip item not found.")
    await ref.delete()
    await search_index.remove(db, "trip", item_id)
    return {"ok": True}
