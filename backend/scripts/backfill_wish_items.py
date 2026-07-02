"""One-off backfill: populate wish_items from EXISTING product notes.

The Wishlist mini-app fans product notes out into users/{uid}/wish_items, but only for notes
ingested AFTER it shipped. This seeds the wishlist from the back-catalogue: every shopping-family
note (is_shopping) that carries a buy URL or price is copied into its owner's Saved inbox.

Pure copy — products are already structured in each note's `data`, so there's no re-scrape and no
Gemini call. Idempotent: enrich_wish_item upserts by canonical buy URL and never clobbers user
state, so a second run finds the same items and changes nothing material.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_wish_items --dry-run
    python -m scripts.backfill_wish_items
"""
import argparse
import asyncio
import logging

from services.firebase import get_db
from services.gemini import is_shopping
from services.wishlist import enrich_wish_item

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_wish")


async def run(dry_run: bool) -> None:
    db = get_db()
    scanned = 0
    products = 0
    by_user: dict[str, int] = {}

    async for doc in db.collection("notes").stream():
        scanned += 1
        n = doc.to_dict() or {}
        if not is_shopping(n.get("content_type", "")):
            continue
        data = n.get("data") or {}
        if not (data.get("buyUrl") or data.get("price")):
            continue
        uid = n.get("user_id")
        if not uid:
            continue
        products += 1
        by_user[uid] = by_user.get(uid, 0) + 1
        if dry_run:
            log.info("would fan out note %s -> %s Saved (%s)", doc.id, uid, n.get("title"))
            continue
        await enrich_wish_item(
            uid, doc.id,
            title=n.get("title", ""),
            cover_image_url=n.get("cover_image_url"),
            source_domain=n.get("source_domain"),
            data=data,
        )
        log.info("fanned out note %s -> %s (%s)", doc.id, uid, n.get("title"))

    log.info("done: scanned=%d product_notes=%d users=%d%s",
             scanned, products, len(by_user), " (dry-run)" if dry_run else "")
    for uid, c in by_user.items():
        log.info("  %s: %d products", uid, c)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
