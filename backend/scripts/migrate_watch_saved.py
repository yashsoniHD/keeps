"""One-off migration: move auto-extracted watch items off the watchlist into the Saved inbox.

The watchlist mini-app gained a third bucket: `saved` (auto-captured from notes) → `to_watch`
(explicitly added to the watchlist) → `watched`. New note fan-outs now seed `saved`, but items
created before this change were all seeded `to_watch`. This re-buckets the existing corpus to match:

  - `watch_status == "to_watch"` AND NOT `added_manually`  →  set to `"saved"`
  - manually-added items (`added_manually == True`) are left on the watchlist (they were intent)
  - `watched` items are never touched

Uses a collection-group query so it covers every user's `users/{uid}/watch_items` subcollection.
Idempotent: a second run finds nothing left to move.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.migrate_watch_saved --dry-run
    python -m scripts.migrate_watch_saved
"""
import argparse
import asyncio
import logging

from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.migrate")


async def run(dry_run: bool) -> None:
    db = get_db()
    scanned = 0
    moved = 0

    async for doc in db.collection_group("watch_items").stream():
        scanned += 1
        d = doc.to_dict() or {}
        if d.get("watch_status") != "to_watch" or d.get("added_manually"):
            continue
        moved += 1
        if dry_run:
            log.info("would move %s -> saved (%s)", doc.reference.path, d.get("title"))
            continue
        await doc.reference.update({"watch_status": "saved"})
        log.info("moved %s -> saved (%s)", doc.reference.path, d.get("title"))

    log.info("done: scanned=%d moved=%d%s",
             scanned, moved, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
