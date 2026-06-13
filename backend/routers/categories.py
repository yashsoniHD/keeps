from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services.auth_dep import require_user
from services.firebase import (
    add_user_category,
    count_notes_by_type,
    get_user_categories,
    remove_user_category,
    retag_notes,
)
from services.gemini import match_existing, normalize_slug

router = APIRouter(tags=["categories"])

# Where a deleted category's notes go by default. Notes are never destroyed on a
# category delete — they move here (non-destructive). If the user deletes "summary"
# itself, the fallback shifts to "bookmark" so notes never land on the slug we're removing.
DEFAULT_MOVE_TARGET = "summary"
FALLBACK_MOVE_TARGET = "bookmark"


class CategoryRename(BaseModel):
    new_name: str


class CategoryCreate(BaseModel):
    name: str


@router.post("/categories")
async def create_category(body: CategoryCreate, user_id: str = Depends(require_user)):
    """Register a new (empty) category on the user's taxonomy. Collapses to an existing
    category if the name is effectively the same one (case/space/plural), so adding a
    near-duplicate doesn't fork the taxonomy. Returns the resolved slug and its note count
    (0 for a freshly-created one)."""
    existing = await get_user_categories(user_id)
    slug = match_existing(normalize_slug(body.name), existing)
    await add_user_category(user_id, slug)
    counts = await count_notes_by_type(user_id)
    return {"slug": slug, "count": counts.get(slug, 0)}


@router.get("/categories")
async def list_categories(user_id: str = Depends(require_user)):
    """The user's taxonomy joined with per-type note counts. Categories with zero
    notes (registered but unused) report count 0."""
    slugs = await get_user_categories(user_id)
    counts = await count_notes_by_type(user_id)
    return [{"slug": s, "count": counts.get(s, 0)} for s in slugs]


@router.patch("/categories/{slug}")
async def rename_category(slug: str, body: CategoryRename, user_id: str = Depends(require_user)):
    """Rename a category: re-tag every note carrying `slug`, then swap the array entry.
    If the new name collapses to a different existing category, that's an intentional
    merge. Excludes `slug` itself from the match so renaming to its own singular/plural
    isn't treated as a no-op."""
    existing = await get_user_categories(user_id)
    new_slug = match_existing(normalize_slug(body.new_name), [c for c in existing if c != slug])
    count = await retag_notes(user_id, slug, new_slug)
    await add_user_category(user_id, new_slug)
    if new_slug != slug:
        await remove_user_category(user_id, slug)
    return {"slug": new_slug, "count": count}


@router.delete("/categories/{slug}")
async def delete_category(slug: str, move_to: str | None = None, user_id: str = Depends(require_user)):
    """Delete a category, re-tagging its notes to a fallback so nothing is lost. The
    target defaults to `summary`; deleting `summary` itself falls back to `bookmark`."""
    target = normalize_slug(move_to) if move_to else DEFAULT_MOVE_TARGET
    if target == slug:
        target = FALLBACK_MOVE_TARGET
    count = await retag_notes(user_id, slug, target)
    await add_user_category(user_id, target)
    await remove_user_category(user_id, slug)
    return {"moved_to": target, "count": count}
