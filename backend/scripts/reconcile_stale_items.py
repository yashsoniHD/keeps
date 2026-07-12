"""One-off healing: reconcile ALREADY-stale mini-app items against their notes' current state.

Bug window: PATCH /api/notes/{id} now reconciles the family item docs on every recategorisation
(services/item_reconcile.py), but that only fires on FUTURE edits. Items orphaned BEFORE the fix
landed — e.g. a note wrongly saved as `product` whose wish_item survived the user's recategorise
to `software` — still sit on the walls (the frontend reads the subcollections directly, so they
never age out). This script sweeps them.

For every item in the family subcollections registered in services/item_reconcile.py's FAMILIES
table (watch/place_items — the wishlist/recipes/trips families were removed 2026-07-12; see
CLAUDE.md) it re-validates each entry of `source_note_ids`: the note must still EXIST and its
CURRENT content_type must still match the family's predicate. Stale note ids are dropped; an item
left with no valid source is deleted along with its search_index doc — exactly the semantics of
the PATCH-time reconcile. The family table (predicate → subcollection → search kind) is imported
from services/item_reconcile.py and the predicates from services/gemini.py — never duplicated.
Items with an empty source_note_ids (e.g. manual adds) are deliberately untouched. No Gemini /
TMDB / Places calls — pure Firestore, so it's free and safe to re-run (idempotent: a healthy item
is a no-op).

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.reconcile_stale_items --uid UID            # dry-run (default)
    python -m scripts.reconcile_stale_items --uid UID --apply
    python -m scripts.reconcile_stale_items --all-users --apply
"""
import argparse
import asyncio
import logging

from services import search_index
from services.firebase import get_db
from services.item_reconcile import FAMILIES

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.reconcile_stale_items")


async def _note_content_type(db, cache: dict, note_id: str) -> str | None:
    """Current content_type of a note, cached per run (the same note backs many items in a
    listicle). None means the note was deleted."""
    if note_id not in cache:
        snap = await db.collection("notes").document(note_id).get()
        cache[note_id] = ((snap.to_dict() or {}).get("content_type") or "") if snap.exists else None
    return cache[note_id]


async def _heal_family(db, dry_run: bool, uid: str | None, predicate, subcollection: str,
                       kind: str, note_cache: dict) -> tuple[int, int, int]:
    """Sweep one family's items. Returns (items scanned, items trimmed, items deleted)."""
    scanned = trimmed = deleted = 0
    stream = (
        db.collection("users").document(uid).collection(subcollection).stream()
        if uid else db.collection_group(subcollection).stream()
    )
    async for doc in stream:
        scanned += 1
        item = doc.to_dict() or {}
        sources = [s for s in (item.get("source_note_ids") or []) if isinstance(s, str)]
        valid = []
        for note_id in sources:
            ct = await _note_content_type(db, note_cache, note_id)
            if ct is not None and predicate(ct):
                valid.append(note_id)
        if valid == sources:
            continue  # healthy (or source-less manual add) — untouched
        stale = [s for s in sources if s not in valid]
        if valid:
            trimmed += 1
            log.info("%s %s (user=%s): dropping stale source note(s) %s, keeping %s",
                     subcollection, doc.id, item.get("user_id"), stale, valid)
            if dry_run:
                continue
            await doc.reference.update({"source_note_ids": valid})
        else:
            deleted += 1
            log.info("%s %s (user=%s): no valid sources left (stale: %s) -> delete",
                     subcollection, doc.id, item.get("user_id"), stale)
            if dry_run:
                continue
            await doc.reference.delete()
            await search_index.remove(db, kind, doc.id)  # same cleanup as the PATCH reconcile

    return scanned, trimmed, deleted


async def run(dry_run: bool, uid: str | None) -> None:
    db = get_db()
    note_cache: dict[str, str | None] = {}  # shared across families — notes are family-agnostic
    suffix = " (dry-run)" if dry_run else ""
    tot_scanned = tot_trimmed = tot_deleted = 0
    for predicate, subcollection, kind, _forward in FAMILIES:
        s, t, d = await _heal_family(db, dry_run, uid, predicate, subcollection, kind, note_cache)
        tot_scanned += s
        tot_trimmed += t
        tot_deleted += d
        log.info("%s: scanned=%d trimmed=%d deleted=%d%s", subcollection, s, t, d, suffix)
    log.info("done: scanned=%d trimmed=%d deleted=%d%s",
             tot_scanned, tot_trimmed, tot_deleted, suffix)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="write changes (default is dry-run: log matches, write nothing)")
    parser.add_argument("--uid", help="heal one user's items")
    parser.add_argument("--all-users", action="store_true",
                        help="heal every user (collection-group scan)")
    args = parser.parse_args()
    if bool(args.uid) == bool(args.all_users):
        parser.error("pass exactly one of --uid or --all-users")
    asyncio.run(run(dry_run=not args.apply, uid=args.uid))
