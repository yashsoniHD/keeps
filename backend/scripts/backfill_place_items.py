"""One-off backfill: populate place_items from EXISTING place notes.

The Places mini-app fans place notes out into users/{uid}/place_items, but only for notes ingested
AFTER it shipped. This seeds the places list from the back-catalogue: every place-family note
(is_places) is read for its venues and copied into its owner's Saved inbox, Google-Places-enriched.

A note saved before the venues[] schema has no `data.venues`; for those we extract the venue names
from the stored text (a lite Gemini call — no re-scrape). Idempotent: enrich_places upserts by
Google place_id and never clobbers user state, so a second run changes nothing material.

Usage (from backend/, with ADC pointing at the project and GOOGLE_MAPS_API_KEY set):
    python -m scripts.backfill_place_items --dry-run
    python -m scripts.backfill_place_items
"""
import argparse
import asyncio
import logging

from services.firebase import get_db
from services.gemini import gemini_service, is_places
from services.places import enrich_places

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_places")


async def run(dry_run: bool) -> None:
    db = get_db()
    scanned = 0
    place_notes = 0
    venues_total = 0
    by_user: dict[str, int] = {}

    async for doc in db.collection("notes").stream():
        scanned += 1
        n = doc.to_dict() or {}
        if not is_places(n.get("content_type", "")):
            continue
        uid = n.get("user_id")
        if not uid:
            continue
        data = n.get("data") or {}
        venues = data.get("venues")
        if not venues and not dry_run:
            venues = await gemini_service.extract_venues_from_note(
                n.get("title", ""), n.get("ai_summary", ""), data,
            )
        if not venues:
            log.info("note %s (%s): no venues%s", doc.id, n.get("title"),
                     " (legacy — would re-extract)" if dry_run else "")
            continue
        place_notes += 1
        venues_total += len(venues)
        by_user[uid] = by_user.get(uid, 0) + len(venues)
        if dry_run:
            log.info("would fan out note %s -> %s Saved (%d venues)", doc.id, uid, len(venues))
            continue
        await enrich_places(uid, doc.id, venues)
        log.info("fanned out note %s -> %s (%d venues)", doc.id, uid, len(venues))

    log.info("done: scanned=%d place_notes=%d venues=%d users=%d%s",
             scanned, place_notes, venues_total, len(by_user), " (dry-run)" if dry_run else "")
    for uid, c in by_user.items():
        log.info("  %s: %d venues", uid, c)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
