from fastapi import APIRouter, Depends

from services.auth_dep import require_user
from services.firebase import (
    add_user_category,
    count_notes_by_type,
    get_user_categories,
    remove_user_category,
    retag_notes,
)
from services.gemini import normalize_slug

router = APIRouter(tags=["categories"])

# Where a deleted category's notes go by default. Notes are never destroyed on a
# category delete — they move here. Deleting "summary" itself falls back to "bookmark".
DEFAULT_MOVE_TARGET = "summary"
FALLBACK_MOVE_TARGET = "bookmark"


@router.get("/categories")
async def list_categories(user_id: str = Depends(require_user)):
    """The user's taxonomy joined with per-type note counts."""
    slugs = await get_user_categories(user_id)
    counts = await count_notes_by_type(user_id)
    return [{"slug": s, "count": counts.get(s, 0)} for s in slugs]


@router.delete("/categories/{slug}")
async def delete_category(slug: str, move_to: str | None = None, user_id: str = Depends(require_user)):
    """Recategorise: drop a category, re-tagging its notes to a fallback so nothing is lost."""
    target = normalize_slug(move_to) if move_to else DEFAULT_MOVE_TARGET
    if target == slug:
        target = FALLBACK_MOVE_TARGET
    count = await retag_notes(user_id, slug, target)
    await add_user_category(user_id, target)
    await remove_user_category(user_id, slug)
    return {"moved_to": target, "count": count}
