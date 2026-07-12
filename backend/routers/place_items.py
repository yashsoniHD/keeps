"""Places mini-app: owner edits to per-venue place_items.

Items live at users/{uid}/place_items/{id}. Firestore rules make the subcollection
client-readable but not client-writable (like watch_items), so every state change — promoting to
to-visit, marking visited, rating, personal notes — goes through these backend endpoints, keeping
the worker-written Google-Places enrichment (photo, rating, coords, hours) safe from client
tampering.

Like the watchlist, there IS a catalog: Google Places search powers a manual-add picker. A venue
can also be added by ingesting its Maps/venue URL through /api/ingest.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services import google_places, search_index
from services.auth_dep import require_user
from services.firebase import flush_usage, get_db, reserve_backfill_run
from services.places import add_by_place_id, backfill_user
from services.usage_meter import start_metering

router = APIRouter(tags=["place_items"])


class PlaceItemUpdate(BaseModel):
    """Owner-editable state on a place item. Send only what changes. `user_notes` may be set to
    null to clear a note; the others mutate the visit state / personal rating / favorite flag.
    `log_visit` records another visit to an already-known place (a place is revisitable) — it bumps
    `visit_count` and `visited_at` without resetting history."""
    place_status: str | None = Field(default=None, pattern="^(saved|to_visit|visited)$")
    user_rating: int | None = Field(default=None, ge=1, le=5)
    user_notes: str | None = Field(default=None, max_length=2000)
    favorite: bool | None = None
    log_visit: bool | None = None


class PlaceItemCreate(BaseModel):
    """Manually add a venue the user picked from Places search."""
    place_id: str


def _item_ref(db, uid: str, item_id: str):
    return db.collection("users").document(uid).collection("place_items").document(item_id)


@router.patch("/place-items/{item_id}")
async def update_place_item(item_id: str, body: PlaceItemUpdate,
                            user_id: str = Depends(require_user)):
    """Promote to-visit / mark Been / log a repeat visit / set a 1–5 personal rating / edit notes /
    toggle favorite. A place is revisitable, so `visited` is a sticky attribute rather than a terminal
    state: the first time it's marked `visited`, `visit_count` becomes 1 and `visited_at` (the *last*
    visit) is stamped; `log_visit` records another visit (bumps `visit_count`, advances `visited_at`)
    without resetting history. Moving *away* from `visited` (a correction) clears both. `user_notes` is
    written only when present in the request body (model_fields_set), so null deliberately clears it."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Place item not found.")
    cur = snap.to_dict() or {}

    now = datetime.now(timezone.utc)
    updates: dict = {"updated_at": now}
    if body.log_visit:
        # Record another visit; ensure the place sits in the Been bucket. Never resets history.
        updates["place_status"] = "visited"
        updates["visited_at"] = now
        updates["visit_count"] = (cur.get("visit_count") or 0) + 1
    elif body.place_status is not None:
        updates["place_status"] = body.place_status
        if body.place_status == "visited":
            updates["visited_at"] = now
            # First time into Been seeds count=1; re-marking an already-Been place keeps its count.
            if cur.get("place_status") != "visited":
                updates["visit_count"] = 1
        else:
            updates["visited_at"] = None
            updates["visit_count"] = 0
    if body.user_rating is not None:
        updates["user_rating"] = body.user_rating
    if "user_notes" in body.model_fields_set:
        updates["user_notes"] = body.user_notes
    if body.favorite is not None:
        updates["favorite"] = body.favorite
    await ref.update(updates)
    return {"ok": True}


@router.get("/place-items/search")
async def search_places(q: str, user_id: str = Depends(require_user)):
    """Google Places search for the manual-add picker. Returns lean venue candidates."""
    return {"results": await google_places.search(q)}


@router.post("/place-items")
async def create_place_item(body: PlaceItemCreate, user_id: str = Depends(require_user)):
    """Manually add a Google Place to the places list (fully enriched, starts in to-visit)."""
    try:
        item_id = await add_by_place_id(user_id, body.place_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": item_id}


@router.get("/place-items/{item_id}/details")
async def place_item_details(item_id: str, user_id: str = Depends(require_user)):
    """Full Google Place details (hours/photo/website/phone) for the detail page. `{}` when the
    item has no Google match (raw venue only)."""
    db = get_db()
    snap = await _item_ref(db, user_id, item_id).get()
    if not snap.exists:
        raise HTTPException(404, "Place item not found.")
    item = snap.to_dict() or {}
    place_id = item.get("place_id")
    if not place_id:
        return {}
    return await google_places.place_details(place_id) or {}


@router.post("/place-items/backfill")
async def backfill_place_items(user_id: str = Depends(require_user)):
    """Import places from the user's existing place notes into the places list. Reads each note's
    `data.venues` (or extracts venue names from its stored text — a lite Gemini call, hence
    metered) and Google-Places-enriches them. Writes are idempotent; runs are capped per day
    because the Gemini/Places spend re-incurs on every run."""
    if not await reserve_backfill_run(user_id, "places"):
        raise HTTPException(429, "Backfill limit reached for today. Try again tomorrow.")
    meter = start_metering()
    try:
        result = await backfill_user(user_id)
    finally:
        await flush_usage(user_id, meter)
    return result


@router.delete("/place-items/{item_id}")
async def delete_place_item(item_id: str, user_id: str = Depends(require_user)):
    """Remove a place from the user's places list."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Place item not found.")
    await ref.delete()
    await search_index.remove(db, "place", item_id)
    return {"ok": True}
