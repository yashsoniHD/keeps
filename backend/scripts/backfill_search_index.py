"""One-off backfill: populate the unified `search_index` from existing notes + mini-app items.

`search_index` (one doc per note OR item, each with its own embedding) is the backbone for
semantic search, Clip AI grounding, and the Library "recent saves" strip. Content saved before it
existed isn't indexed yet — this sweeps the whole corpus in.

  - notes → reuse each note's STORED embedding (no re-embed); notes without one are indexed
    without a vector (still returned by the recency strip; re-embed later via backfill_embeddings).
  - mini-app items (watch/wish/recipe/place/trip) have no stored embedding, so each is embedded
    once here from its title + summary — a real (one-time) cost, bounded by the corpus size.

Idempotent: search_index doc ids are `{kind}-{ref_id}`, so re-running upserts in place. MUST run
BEFORE migrate_drop_miniapp_notes so search never regresses.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_search_index --dry-run
    python -m scripts.backfill_search_index
    python -m scripts.backfill_search_index --notes-only   # skip the item embed cost
"""
import argparse
import asyncio
import logging

from services import search_index
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_search")

# collection-group → (kind, title field candidates, summary field candidates, cover field candidates)
ITEM_SPECS = {
    "watch_items": ("watch", ("title",), ("overview", "why"), ("poster_url",)),
    "wish_items": ("wish", ("title",), ("verdict",), ("image_url",)),
    "recipe_items": ("recipe", ("title",), ("cuisine",), ("image_url",)),
    "place_items": ("place", ("name",), ("why", "category"), ("photo_url",)),
    "trip_items": ("trip", ("title",), ("destination",), ("image_url",)),
}


def _first(d: dict, keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = d.get(k)
        if v:
            return v
    return None


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


async def _backfill_items(db, dry_run: bool) -> tuple[int, int]:
    scanned = indexed = 0
    for group, (kind, tkeys, skeys, ckeys) in ITEM_SPECS.items():
        async for doc in db.collection_group(group).stream():
            scanned += 1
            d = doc.to_dict() or {}
            uid = d.get("user_id")
            title = _first(d, tkeys)
            if not uid or not title:
                continue
            indexed += 1
            if dry_run:
                continue
            await search_index.upsert(
                db, user_id=uid, kind=kind, ref_id=doc.id, title=title,
                summary=_first(d, skeys) or "", cover_image_url=_first(d, ckeys),
                created_at=d.get("created_at"),
            )
    return scanned, indexed


async def run(dry_run: bool, notes_only: bool) -> None:
    db = get_db()
    n_scanned, n_indexed = await _backfill_notes(db, dry_run)
    log.info("notes: scanned=%d indexed=%d", n_scanned, n_indexed)
    if not notes_only:
        i_scanned, i_indexed = await _backfill_items(db, dry_run)
        log.info("items: scanned=%d indexed=%d", i_scanned, i_indexed)
    log.info("done%s", " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="count without writing/embedding")
    parser.add_argument("--notes-only", action="store_true", help="skip item embedding")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run, args.notes_only))
