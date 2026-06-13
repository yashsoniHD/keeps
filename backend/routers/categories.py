from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services.auth_dep import require_user
from services.firebase import (
    add_user_category,
    count_notes_by_type,
    get_category_meta,
    get_user_categories,
    move_category_meta,
    remove_category_meta,
    remove_user_category,
    retag_notes,
    set_category_meta,
)
from services.gemini import match_existing, normalize_slug

router = APIRouter(tags=["categories"])

# Where a deleted category's notes go by default. Notes are never destroyed on a
# category delete — they move here (non-destructive). If the user deletes "summary"
# itself, the fallback shifts to "bookmark" so notes never land on the slug we're removing.
DEFAULT_MOVE_TARGET = "summary"
FALLBACK_MOVE_TARGET = "bookmark"

# Cosmetic overrides are user-facing strings/indices the frontend controls — but validate
# anyway so a malformed client can't bloat the user doc. The icon name maps to a fixed
# frontend set (note-meta CATEGORY_ICONS); palette indexes the 8 PALETTES.
MAX_ICON_NAME_LEN = 40
PALETTE_MAX = 8


def _clean_icon(icon: str | None) -> str | None:
    if not icon:
        return None
    icon = icon.strip()
    return icon[:MAX_ICON_NAME_LEN] if icon else None


def _clean_palette(palette: int | None) -> int | None:
    if palette is None:
        return None
    return palette if 0 <= palette < PALETTE_MAX else None


class CategoryUpdate(BaseModel):
    """PATCH body: any subset of rename + re-skin."""

    new_name: str | None = None
    icon: str | None = None
    palette: int | None = None


class CategoryCreate(BaseModel):
    name: str
    icon: str | None = None
    palette: int | None = None


async def _list_payload(user_id: str) -> list[dict]:
    """Categories joined with note counts and any icon/colour overrides."""
    slugs = await get_user_categories(user_id)
    counts = await count_notes_by_type(user_id)
    meta = await get_category_meta(user_id)
    out = []
    for s in slugs:
        m = meta.get(s) or {}
        out.append({
            "slug": s,
            "count": counts.get(s, 0),
            "icon": m.get("icon"),
            "palette": m.get("palette"),
        })
    return out


@router.post("/categories")
async def create_category(body: CategoryCreate, user_id: str = Depends(require_user)):
    """Register a new (empty) category on the user's taxonomy. Collapses to an existing
    category if the name is effectively the same one (case/space/plural), so adding a
    near-duplicate doesn't fork the taxonomy. An optional icon/palette pins the look.
    Returns the resolved slug, its note count, and any override."""
    existing = await get_user_categories(user_id)
    slug = match_existing(normalize_slug(body.name), existing)
    await add_user_category(user_id, slug)
    icon, palette = _clean_icon(body.icon), _clean_palette(body.palette)
    if icon is not None or palette is not None:
        await set_category_meta(user_id, slug, icon, palette)
    counts = await count_notes_by_type(user_id)
    return {"slug": slug, "count": counts.get(slug, 0), "icon": icon, "palette": palette}


@router.get("/categories")
async def list_categories(user_id: str = Depends(require_user)):
    """The user's taxonomy joined with per-type note counts and icon/colour overrides.
    Categories with zero notes (registered but unused) report count 0."""
    return await _list_payload(user_id)


@router.patch("/categories/{slug}")
async def update_category(slug: str, body: CategoryUpdate, user_id: str = Depends(require_user)):
    """Rename and/or re-skin a category. When new_name is given: re-tag every note carrying
    `slug`, swap the array entry, and carry any icon/colour to the new slug (a collapse to a
    different existing category is an intentional merge). Icon/palette in the body are then
    applied to the resolved slug. Excludes `slug` itself from the rename match so renaming to
    its own singular/plural isn't a no-op."""
    target_slug = slug
    count = 0
    if body.new_name is not None and body.new_name.strip():
        existing = await get_user_categories(user_id)
        new_slug = match_existing(normalize_slug(body.new_name), [c for c in existing if c != slug])
        count = await retag_notes(user_id, slug, new_slug)
        await add_user_category(user_id, new_slug)
        if new_slug != slug:
            await move_category_meta(user_id, slug, new_slug)
            await remove_user_category(user_id, slug)
        target_slug = new_slug

    icon, palette = _clean_icon(body.icon), _clean_palette(body.palette)
    if icon is not None or palette is not None:
        await set_category_meta(user_id, target_slug, icon, palette)

    meta = (await get_category_meta(user_id)).get(target_slug) or {}
    return {
        "slug": target_slug,
        "count": count,
        "icon": meta.get("icon"),
        "palette": meta.get("palette"),
    }


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
    await remove_category_meta(user_id, slug)
    return {"moved_to": target, "count": count}
