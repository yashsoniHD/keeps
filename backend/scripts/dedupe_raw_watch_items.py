"""One-off cleanup: remove stale raw_ watch_items that now have a TMDB-matched twin.

Early imports (before the TMDB token was configured) created raw_{slug}_{year} docs with no
poster — TMDB matching was a no-op. A later re-import, once TMDB resolved, created m_{id}/t_{id}
docs WITH posters for the same titles, but the raw docs were left behind. The result: every title
shows twice — one enriched copy and one bare copy with no poster/details.

For each user, this finds raw_ docs whose normalized title also exists as a matched m_/t_ doc,
folds their source_note_ids into the matched doc, then deletes the raw doc. Raw docs with no
matched twin (a title TMDB still can't resolve, e.g. "8 ½") are left untouched. Idempotent: a
second run finds nothing left to fold.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.dedupe_raw_watch_items --dry-run
    python -m scripts.dedupe_raw_watch_items
"""
import argparse
import asyncio
import logging
import re

from google.cloud.firestore_v1 import ArrayUnion

from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.dedupe")


def _norm(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "").strip().lower())


async def run(dry_run: bool) -> None:
    db = get_db()

    # Group docs by their parent watch_items collection (one per user), keyed by path.
    collections: dict[str, dict] = {}
    async for doc in db.collection_group("watch_items").stream():
        coll = doc.reference.parent
        entry = collections.setdefault(coll.path, {"ref": coll, "docs": []})
        entry["docs"].append((doc.id, doc.to_dict() or {}))

    scanned = 0
    deleted = 0
    for entry in collections.values():
        coll = entry["ref"]
        docs = entry["docs"]
        scanned += len(docs)

        # Normalized titles that have an enriched (TMDB-matched) doc.
        matched: dict[str, str] = {}
        for doc_id, d in docs:
            if d.get("tmdb_id") and (doc_id.startswith("m_") or doc_id.startswith("t_")):
                matched[_norm(d.get("title", ""))] = doc_id

        for doc_id, d in docs:
            if not doc_id.startswith("raw_"):
                continue
            twin = matched.get(_norm(d.get("title", "")))
            if not twin:
                continue  # genuinely unmatched raw — keep it
            deleted += 1
            note_ids = d.get("source_note_ids") or []
            if dry_run:
                log.info("would delete %s/%s -> fold %d note(s) into %s",
                         coll.id, doc_id, len(note_ids), twin)
                continue
            if note_ids:
                await coll.document(twin).update({"source_note_ids": ArrayUnion(note_ids)})
            await coll.document(doc_id).delete()
            log.info("deleted %s -> folded %d note(s) into %s", doc_id, len(note_ids), twin)

    log.info("done: scanned=%d deleted=%d%s",
             scanned, deleted, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
