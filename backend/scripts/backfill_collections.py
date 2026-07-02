"""One-off migration: fan legacy collection membership onto notes as `collection_id`.

Collections used to store membership as a `note_ids[]` array on the collection doc. Membership now
lives on each note as a single `collection_id` (backend-written, single-home). This copies the old
arrays onto the notes:

  - for each collection, each id in its `note_ids[]` → set that note's `collection_id` to the
    collection id, UNLESS the note already has one (first-writer-wins; a note can't be multi-home).
  - conflicts (a note listed in two collections) are logged and left with their first assignment.
  - each reassigned note is re-indexed in search_index so its bucket mirror stays correct.

Leaves the legacy `note_ids[]` in place (harmless; the app no longer reads it). Idempotent: a second
run finds every note already assigned and does nothing.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_collections --dry-run
    python -m scripts.backfill_collections
"""
import argparse
import asyncio
import logging

from services import search_index
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_collections")


async def run(dry_run: bool) -> None:
    db = get_db()
    collections = assigned = conflicts = missing = 0

    async for col in db.collection("collections").stream():
        collections += 1
        c = col.to_dict() or {}
        uid = c.get("user_id")
        note_ids = c.get("note_ids") or []
        for note_id in note_ids:
            note_ref = db.collection("notes").document(note_id)
            snap = await note_ref.get()
            d = snap.to_dict() if snap.exists else None
            if not d or d.get("user_id") != uid:
                missing += 1
                continue
            existing = d.get("collection_id")
            if existing:
                if existing != col.id:
                    conflicts += 1
                    log.warning("conflict: note %s already in %s, not moving to %s",
                                note_id, existing, col.id)
                continue  # first-writer-wins
            assigned += 1
            if dry_run:
                log.info("would assign note %s -> collection %s", note_id, col.id)
                continue
            await note_ref.update({"collection_id": col.id})
            await search_index.upsert_for_note(
                db, note_id, {**d, "collection_id": col.id}, d.get("embedding"))

    log.info("done: collections=%d assigned=%d conflicts=%d missing=%d%s",
             collections, assigned, conflicts, missing, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
