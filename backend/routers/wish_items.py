"""Wishlist mini-app: owner edits to per-product wish_items.

Items live at users/{uid}/wish_items/{id}. Firestore rules make the subcollection
client-readable but not client-writable (like watch_items), so every state change — promoting to
to-buy, marking purchased, setting a target price — goes through these backend endpoints, keeping
the worker-written enrichment fields (price, image, buy URL) safe from client tampering.

There is no catalog search / add-by-id here (unlike the watchlist): a product is added simply by
ingesting its URL through the normal /api/ingest flow, which creates a product note that fans out
into a wish_item. So this router only covers owner state edits, delete, and backfill.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services import search_index
from services.auth_dep import require_user
from services.firebase import get_db
from services.wishlist import backfill_user

router = APIRouter(tags=["wish_items"])


class WishItemUpdate(BaseModel):
    """Owner-editable state on a wish item. Send only what changes. `target_price` may be set
    to null to clear a price target; the others mutate the buy/purchase state."""
    wish_status: str | None = Field(default=None, pattern="^(saved|to_buy|purchased)$")
    target_price: float | None = Field(default=None, ge=0)
    favorite: bool | None = None


def _item_ref(db, uid: str, item_id: str):
    return db.collection("users").document(uid).collection("wish_items").document(item_id)


@router.patch("/wish-items/{item_id}")
async def update_wish_item(item_id: str, body: WishItemUpdate,
                           user_id: str = Depends(require_user)):
    """Promote to-buy / mark purchased / set a target price. Moving to `purchased` stamps
    `purchased_at`; moving back clears it. `target_price` is sent only when the field is present
    in the request body (model_fields_set), so null deliberately clears a target."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Wish item not found.")

    now = datetime.now(timezone.utc)
    updates: dict = {"updated_at": now}
    if body.wish_status is not None:
        updates["wish_status"] = body.wish_status
        updates["purchased_at"] = now if body.wish_status == "purchased" else None
    if "target_price" in body.model_fields_set:
        updates["target_price"] = body.target_price
    if body.favorite is not None:
        updates["favorite"] = body.favorite
    await ref.update(updates)
    return {"ok": True}


@router.post("/wish-items/backfill")
async def backfill_wish_items(user_id: str = Depends(require_user)):
    """Import products from the user's existing product notes into the wishlist. Reads each
    note's already-structured `data` (no re-scraping, no Gemini). Safe to re-run (idempotent)."""
    return await backfill_user(user_id)


@router.delete("/wish-items/{item_id}")
async def delete_wish_item(item_id: str, user_id: str = Depends(require_user)):
    """Remove a product from the user's wishlist."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Wish item not found.")
    await ref.delete()
    await search_index.remove(db, "wish", item_id)
    return {"ok": True}
