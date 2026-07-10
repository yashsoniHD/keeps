"""Backfill/repair the `search_index` from existing notes (notes-only after the collapse).

`search_index` (one doc per note, each with its own embedding) is the backbone for semantic
search, Clip AI grounding, and the "recent saves" strip. Re-running refreshes every note's
entry — including fields added later (e.g. `content_type`, which search rows use for their
icon/accent) — reusing each note's STORED embedding (no re-embed); notes without one are
indexed without a vector (re-embed later via backfill_embeddings).

`--prune-items` also deletes legacy mini-app entries (kind != "note") left from before the
notes-first collapse — their items were folded into notes by migrate_items_to_notes, so the
stale entries would otherwise surface dead links in search.

Idempotent: search_index doc ids are `{kind}-{ref_id}`, so re-running upserts in place.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_search_index --dry-run
    python -m scripts.backfill_search_index --prune-items
"""
import argparse
import asyncio
import logging

from services import search_index
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_search")


async def _backfill_notes(db, dry_run: bool) -> tuple[int, int]:
    scanned = indexed = 0
    async for doc in db.collection("notes").stream():
        scanned += 1
        d = doc.to_dict() or {}
        if not d.get("user_id"):
            continue
        indexed += 1
        if dry_run:
            continue
        # Reuse the stored embedding; upsert_for_note only re-embeds when it's absent.
        await search_index.upsert_for_note(db, doc.id, d, d.get("embedding"))
    return scanned, indexed


async def _prune_items(db, dry_run: bool) -> int:
    pruned = 0
    async for doc in db.collection(search_index.COLLECTION).stream():
        if (doc.to_dict() or {}).get("kind") == "note":
            continue
        pruned += 1
        if not dry_run:
            await doc.reference.delete()
    return pruned


async def run(dry_run: bool, prune_items: bool) -> None:
    db = get_db()
    n_scanned, n_indexed = await _backfill_notes(db, dry_run)
    log.info("notes: scanned=%d indexed=%d", n_scanned, n_indexed)
    if prune_items:
        pruned = await _prune_items(db, dry_run)
        log.info("legacy item entries pruned: %d", pruned)
    log.info("done%s", " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="count without writing")
    parser.add_argument("--prune-items", action="store_true",
                        help="delete legacy mini-app entries (kind != 'note')")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run, args.prune_items))
