"""One-off backfill: populate recipe_items from EXISTING recipe notes.

The Recipes mini-app fans recipe notes out into users/{uid}/recipe_items, but only for notes
ingested AFTER it shipped. This seeds the cookbook from the back-catalogue: every cooking-family
note (is_recipe) that carries ingredients is copied into its owner's cookbook.

Pure copy — recipes are already structured in each note's `data`, so there's no re-scrape and no
Gemini call. Idempotent: enrich_recipe_item upserts by canonical URL and never clobbers user
state, so a second run finds the same items and changes nothing material.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_recipe_items --dry-run
    python -m scripts.backfill_recipe_items
"""
import argparse
import asyncio
import logging

from services.firebase import get_db
from services.gemini import is_recipe
from services.recipes import enrich_recipe_item

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_recipes")


async def run(dry_run: bool) -> None:
    db = get_db()
    scanned = 0
    recipes = 0
    by_user: dict[str, int] = {}

    async for doc in db.collection("notes").stream():
        scanned += 1
        n = doc.to_dict() or {}
        if not is_recipe(n.get("content_type", "")):
            continue
        data = n.get("data") or {}
        if not data.get("ingredients"):
            continue
        uid = n.get("user_id")
        if not uid:
            continue
        recipes += 1
        by_user[uid] = by_user.get(uid, 0) + 1
        if dry_run:
            log.info("would fan out note %s -> %s cookbook (%s)", doc.id, uid, n.get("title"))
            continue
        await enrich_recipe_item(
            uid, doc.id,
            title=n.get("title", ""),
            cover_image_url=n.get("cover_image_url"),
            source_url=n.get("source_url"),
            source_domain=n.get("source_domain"),
            data=data,
        )
        log.info("fanned out note %s -> %s (%s)", doc.id, uid, n.get("title"))

    log.info("done: scanned=%d recipe_notes=%d users=%d%s",
             scanned, recipes, len(by_user), " (dry-run)" if dry_run else "")
    for uid, c in by_user.items():
        log.info("  %s: %d recipes", uid, c)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
