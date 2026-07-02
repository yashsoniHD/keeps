"""One-off migration: delete legacy mini-app notes whose item(s) already exist.

Going forward, a recipe/movie/product/place/trip capture creates ONLY its mini-app item — no note
(see routers/process.py). But notes saved before that change have BOTH a note and a fanned-out
item. This removes those now-redundant notes so they stop showing in the Notes feed.

Safety: a note is deleted only when it's a mini-app family AND at least one item actually references
it (via `source_note_ids`). We first scan every `*_items` subcollection once to build the set of
note ids that have materialized items, then delete only mini-app notes in that set — so a note whose
fan-out failed (no item) is preserved, never silently lost. Each deleted note's search_index entry
is removed too (the item keeps its own entry).

MUST run AFTER backfill_search_index (so item content is searchable before the notes go) and after
the per-mini-app item backfills (so every legacy note has its item). Idempotent.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.migrate_drop_miniapp_notes --dry-run
    python -m scripts.migrate_drop_miniapp_notes
"""
import argparse
import asyncio
import logging

from services import search_index
from services.firebase import get_db
from services.gemini import (
    is_entertainment,
    is_itinerary,
    is_places,
    is_recipe,
    is_shopping,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.drop_miniapp_notes")

ITEM_GROUPS = ("watch_items", "wish_items", "recipe_items", "place_items", "trip_items")


def _is_mini_app(content_type: str) -> bool:
    return (
        is_entertainment(content_type)
        or is_shopping(content_type)
        or is_places(content_type)
        or is_recipe(content_type)
        or is_itinerary(content_type)
    )


async def _covered_note_ids(db) -> set[str]:
    """Every note id referenced by a materialized mini-app item."""
    covered: set[str] = set()
    for group in ITEM_GROUPS:
        async for doc in db.collection_group(group).stream():
            for nid in (doc.to_dict() or {}).get("source_note_ids") or []:
                covered.add(nid)
    return covered


async def run(dry_run: bool) -> None:
    db = get_db()
    covered = await _covered_note_ids(db)
    log.info("note ids with a materialized item: %d", len(covered))

    scanned = deleted = kept_no_item = 0
    async for doc in db.collection("notes").stream():
        scanned += 1
        d = doc.to_dict() or {}
        if not _is_mini_app(d.get("content_type", "")):
            continue
        if doc.id not in covered:
            kept_no_item += 1  # fan-out never produced an item — keep the note as the record
            log.warning("keeping mini-app note %s (%s) — no item found",
                        doc.id, d.get("title"))
            continue
        deleted += 1
        if dry_run:
            log.info("would delete note %s (%s / %s)", doc.id, d.get("content_type"), d.get("title"))
            continue
        await doc.reference.delete()
        await search_index.remove(db, "note", doc.id)

    log.info("done: scanned=%d deleted=%d kept_no_item=%d%s",
             scanned, deleted, kept_no_item, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show deletions without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
