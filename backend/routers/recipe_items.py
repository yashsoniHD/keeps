"""Recipes mini-app: owner edits to per-recipe recipe_items.

Items live at users/{uid}/recipe_items/{id}. Firestore rules make the subcollection
client-readable but not client-writable (like watch_items/wish_items), so every state change goes
through these backend endpoints, keeping the worker-written enrichment fields (ingredients, steps,
image) safe from client tampering.

Recipes have no status workflow (no saved/to-cook/cooked buckets) — the cookbook is one wall
organised by filters + favorites — so the only owner-editable field is `favorite`. As with the
wishlist, a recipe is "added" simply by ingesting its URL through the normal /api/ingest flow,
which creates a recipe note that fans out into a recipe_item. So this router only covers the
favorite toggle, delete, and backfill.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services import search_index
from services.auth_dep import require_user
from services.firebase import get_db
from services.recipes import backfill_user

router = APIRouter(tags=["recipe_items"])


class RecipeItemUpdate(BaseModel):
    """Owner-editable state on a recipe item. Recipes have no status buckets, so the only
    mutable field is the favorite star."""
    favorite: bool | None = None


def _item_ref(db, uid: str, item_id: str):
    return db.collection("users").document(uid).collection("recipe_items").document(item_id)


@router.patch("/recipe-items/{item_id}")
async def update_recipe_item(item_id: str, body: RecipeItemUpdate,
                             user_id: str = Depends(require_user)):
    """Toggle the favorite star on a recipe."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Recipe item not found.")

    updates: dict = {"updated_at": datetime.now(timezone.utc)}
    if body.favorite is not None:
        updates["favorite"] = body.favorite
    await ref.update(updates)
    return {"ok": True}


@router.post("/recipe-items/backfill")
async def backfill_recipe_items(user_id: str = Depends(require_user)):
    """Import recipes from the user's existing recipe notes into the cookbook. Reads each note's
    already-structured `data` (no re-scraping, no Gemini). Safe to re-run (idempotent)."""
    return await backfill_user(user_id)


@router.delete("/recipe-items/{item_id}")
async def delete_recipe_item(item_id: str, user_id: str = Depends(require_user)):
    """Remove a recipe from the user's cookbook."""
    db = get_db()
    ref = _item_ref(db, user_id, item_id)
    snap = await ref.get()
    if not snap.exists:
        raise HTTPException(404, "Recipe item not found.")
    await ref.delete()
    await search_index.remove(db, "recipe", item_id)
    return {"ok": True}
