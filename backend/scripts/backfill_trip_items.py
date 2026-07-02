"""One-off backfill: populate trip_items from EXISTING itinerary notes.

The Trips mini-app fans itinerary notes out into users/{uid}/trip_items, but only for notes ingested
AFTER it shipped. This seeds the wall from the back-catalogue.

Notes that already carry a day-by-day `data.days` are a pure copy. Travel notes saved before the
Trips app (classified as travel/travel-destination-guide/etc. and extracted with the generic
composer, so no days[]) get a one-off Gemini re-extraction off their STORED text — see
services/itineraries.backfill_user / gemini.extract_days_from_note — which derives a real itinerary
and skips notes that aren't actually trips (single spots / venue roundups). Idempotent: fan-out
upserts by canonical URL and never clobbers user state, so a second run is safe.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_trip_items --dry-run
    python -m scripts.backfill_trip_items
"""
import argparse
import asyncio
import logging

from services.firebase import get_db
from services.gemini import is_itinerary
from services.itineraries import backfill_user

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_trips")


async def run(dry_run: bool) -> None:
    db = get_db()
    # Distinct users who have at least one travel-family note.
    scanned = 0
    uids: set[str] = set()
    async for doc in db.collection("notes").stream():
        scanned += 1
        n = doc.to_dict() or {}
        if is_itinerary(n.get("content_type", "")) and n.get("user_id"):
            uids.add(n["user_id"])

    log.info("scanned=%d, %d user(s) with travel notes%s",
             scanned, len(uids), " (dry-run — no writes / no Gemini)" if dry_run else "")
    if dry_run:
        for uid in uids:
            log.info("  would backfill trips for %s", uid)
        return

    total = 0
    for uid in uids:
        res = await backfill_user(uid)  # re-extracts day plans + geocodes + upserts
        total += res["trips_found"]
        log.info("  %s: %d trips (from %d travel notes)", uid, res["trips_found"],
                 res["notes_processed"])
    log.info("done: %d trips across %d user(s)", total, len(uids))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="list users without writing / calling Gemini")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
