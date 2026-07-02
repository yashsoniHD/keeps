"""Watchlist mini-app: owner edits to per-title watch_items.

Items live at users/{uid}/watch_items/{id}. Firestore rules make the subcollection
client-readable but not client-writable (like notes/jobs), so every state change — marking
watched, rating — goes through these backend endpoints, keeping the TMDB enrichment fields
(poster, tmdb_id, providers) safe from client tampering.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services import tmdb
from services import search_index
from services.auth_dep import require_user
from services.firebase import flush_usage, get_db, reserve_backfill_run
from services.usage_meter import start_metering
from services.watchlist import add_by_tmdb, backfill_user

router = APIRouter(tags=["watch_items"])


class WatchItemUpdate(BaseModel):
    """Owner-editable state on a watch item. Send only what changes."""
    watch_status: str | None = Field(default=None, pattern="^(saved|to_watch|watching|watched)$")
    rating: int | None = Field(default=None, ge=1, le=5)
    favorite: bool | None = None


class WatchItemCreate(BaseModel):
    """Manually add a title the user picked from TMDB search."""
    tmdb_id: int
    media_type: str = Field(pattern="^(movie|tv)$")


def _item_ref(db, uid: str, item_id: str):
    return db.collection("users").document(uid).collection("watch_items").document(item_id)


@router.patch("/watch-items/{item_id}")
async def update_watch_item(item_id: str, body: WatchItemUpdate,
                            user_id: str = Depends(require_user)):
    """Move between buckets (saved/to_watch/watching/watched) / set a 1–5 rating / toggle favorite.
    Moving to `watched` stamps `watched_at`; moving to any other bucket clears it. `favorite` is a
    cross-cutting flag independent of the bucket."""
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
    if body.favorite is not None:
        updates["favorite"] = body.favorite
    await ref.update(updates)
    return {"ok": True}


@router.get("/watch-items/search")
async def search_titles(q: str, user_id: str = Depends(require_user)):
    """TMDB search for the manual-add picker. Returns lean movie/tv candidates."""
    return {"results": await tmdb.search(q)}


@router.post("/watch-items")
async def create_watch_item(body: WatchItemCreate, user_id: str = Depends(require_user)):
    """Manually add a TMDB title to the watchlist (fully enriched)."""
    try:
        item_id = await add_by_tmdb(user_id, body.tmdb_id, body.media_type)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": item_id}


@router.get("/watch-items/{item_id}/details")
async def watch_item_details(item_id: str, user_id: str = Depends(require_user)):
    """Full TMDB details (cast/runtime/seasons/rating) for the detail page. `{}` when the item
    has no TMDB match (raw title only)."""
    db = get_db()
    snap = await _item_ref(db, user_id, item_id).get()
    if not snap.exists:
        raise HTTPException(404, "Watch item not found.")
    item = snap.to_dict() or {}
    tmdb_id, media_type = item.get("tmdb_id"), item.get("media_type")
    if not tmdb_id or media_type not in ("movie", "tv"):
        return {}
    return await tmdb.details(tmdb_id, media_type) or {}


@router.post("/watch-items/backfill")
async def backfill_watch_items(user_id: str = Depends(require_user)):
    """Import movies & shows from the user's existing entertainment notes into the watchlist.
    Extracts the titles named in each note (no re-scraping) and TMDB-enriches them. Writes are
    idempotent — re-running (e.g. after the TMDB token is configured) is safe — but the Gemini
    title-extraction spend re-incurs each run, so runs are capped per day."""
    if not await reserve_backfill_run(user_id, "watchlist"):
        raise HTTPException(429, "Backfill limit reached for today. Try again tomorrow.")
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
    await search_index.remove(db, "watch", item_id)
    return {"ok": True}
