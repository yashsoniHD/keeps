"""Watchlist mini-app: owner edits to per-title watch_items.

Items live at users/{uid}/watch_items/{id}. Firestore rules make the subcollection
client-readable but not client-writable (like notes/jobs), so every state change — marking
watched, rating — goes through these backend endpoints, keeping the TMDB enrichment fields
(poster, tmdb_id, providers) safe from client tampering.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.auth_dep import require_user
from services.firebase import flush_usage, get_db
from services.usage_meter import start_metering
from services.watchlist import backfill_user

router = APIRouter(tags=["watch_items"])


class WatchItemUpdate(BaseModel):
    """Owner-editable state on a watch item. Send only what changes."""
    watch_status: str | None = Field(default=None, pattern="^(to_watch|watched)$")
    rating: int | None = Field(default=None, ge=1, le=5)


def _item_ref(db, uid: str, item_id: str):
    return db.collection("users").document(uid).collection("watch_items").document(item_id)


@router.patch("/watch-items/{item_id}")
async def update_watch_item(item_id: str, body: WatchItemUpdate,
                            user_id: str = Depends(require_user)):
    """Toggle watched / set a 1–5 rating. Moving to `watched` stamps `watched_at`; moving
    back to `to_watch` clears it."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Watch item not found.")

    now = datetime.now(timezone.utc)
    updates: dict = {"updated_at": now}
    if body.watch_status is not None:
        updates["watch_status"] = body.watch_status
        updates["watched_at"] = now if body.watch_status == "watched" else None
    if body.rating is not None:
        updates["rating"] = body.rating
    await ref.update(updates)
    return {"ok": True}


@router.post("/watch-items/backfill")
async def backfill_watch_items(user_id: str = Depends(require_user)):
    """Import movies & shows from the user's existing entertainment notes into the watchlist.
    Extracts the titles named in each note (no re-scraping) and TMDB-enriches them. Safe to
    re-run (e.g. after the TMDB token is configured, to add posters)."""
    meter = start_metering()
    try:
        result = await backfill_user(user_id)
    finally:
        await flush_usage(user_id, meter)
    return result


@router.delete("/watch-items/{item_id}")
async def delete_watch_item(item_id: str, user_id: str = Depends(require_user)):
    """Remove a watch item from the user's watchlist."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Watch item not found.")
    await ref.delete()
    return {"ok": True}
