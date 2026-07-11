"""One-off backfill: fill in embeddings that a past Vertex embed-quota failure left missing.

Verified failure mode: a "Turkey trip" Ask AI question failed to retrieve the existing "An eight
day Turkey itinerary" note — the note (or its search_index entry) had no `embedding` field, so it
was invisible to `find_nearest` (Ask AI's semantic candidate pool, `services/note_retrieval.py`)
and to `/api/search` (`search_index`). Both collections can independently end up missing a vector:
`notes.embedding` (the field Ask AI's vector query reads) and `search_index.{doc}.embedding` (a
separate write that can fail even when the note's own embed succeeded).

Strategy per user:
  - notes missing `embedding`: re-embed from title+summary (paced, retried once), write it back,
    then re-upsert search_index through the SAME helper production ingest uses
    (`services.search_index.upsert_for_note`) — one embed call fixes both collections at once.
  - search_index entries missing `embedding` whose note (kind="note") already HAS one (either
    already, or just fixed above): reuse it — zero extra embed calls.
  - search_index entries still missing one (kind != "note", e.g. a Places-mini-app "place" entry
    with no backing note, or a note-kind entry whose note itself has no title+summary text to
    embed): re-embed directly from the search_index doc's own title+summary.

Dry-run (default) reports counts per user without writing or making any embed calls; --apply does
the real work, paced at --per-minute (default 15 — text-embedding-005 QPM quota is tiny) with one
retry on failure.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_missing_embeddings                  # dry-run (default)
    python -m scripts.backfill_missing_embeddings --apply
    python -m scripts.backfill_missing_embeddings --apply --user-id UID
    python -m scripts.backfill_missing_embeddings --apply --per-minute 20
"""
import argparse
import asyncio
import logging
from collections import defaultdict

from google.cloud.firestore_v1.vector import Vector

from services import search_index
from services.embeddings import embedding_service
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_missing_embeddings")

DEFAULT_PER_MINUTE = 15


async def _embed_with_retry(text: str) -> Vector | None:
    """Embed `text`, retrying once on failure. None if the text is blank or both attempts fail."""
    text = (text or "").strip()
    if not text:
        return None
    for attempt in range(2):
        try:
            vec = await embedding_service.embed_document(text)
            return Vector(vec) if vec else None
        except Exception as e:  # noqa: BLE001 — quota/transient errors get one retry.
            log.warning("embed attempt %d failed: %s: %s", attempt + 1, type(e).__name__, e)
            if attempt == 0:
                await asyncio.sleep(2.0)
    return None


async def _fix_notes(db, dry_run: bool, user_id: str | None, delay: float,
                     per_user: dict) -> tuple[int, int, int, int, dict[str, Vector]]:
    """Returns (scanned, missing, fixed, failed, {note_id: fresh_embedding}) — the last so
    _fix_search_index can reuse a just-computed note embedding for free."""
    query = db.collection("notes")
    if user_id:
        query = query.where("user_id", "==", user_id)

    scanned = missing = fixed = failed = 0
    fresh: dict[str, Vector] = {}

    async for doc in query.stream():
        scanned += 1
        note = doc.to_dict() or {}
        if note.get("embedding") is not None:
            continue
        missing += 1
        per_user[note.get("user_id", "?")]["notes_missing"] += 1
        if dry_run:
            continue

        text = "\n".join(p for p in (note.get("title", ""), note.get("ai_summary", "")) if p)
        vec = await _embed_with_retry(text)
        if vec is None:
            failed += 1
            log.warning("could not embed note %s (no usable text or embed failed)", doc.id)
            continue

        await doc.reference.set({"embedding": vec}, merge=True)
        merged = {**note, "embedding": vec}
        await search_index.upsert_for_note(db, doc.id, merged, vec)
        fresh[doc.id] = vec
        fixed += 1
        log.info("embedded note %s", doc.id)
        if delay:
            await asyncio.sleep(delay)

    return scanned, missing, fixed, failed, fresh


async def _fix_search_index(db, dry_run: bool, user_id: str | None, delay: float,
                            per_user: dict, note_embeddings: dict[str, Vector]) -> tuple[int, int, int, int]:
    query = db.collection("search_index")
    if user_id:
        query = query.where("user_id", "==", user_id)

    scanned = missing = fixed = failed = 0

    async for doc in query.stream():
        scanned += 1
        entry = doc.to_dict() or {}
        if entry.get("embedding") is not None:
            continue
        missing += 1
        per_user[entry.get("user_id", "?")]["search_index_missing"] += 1
        if dry_run:
            continue

        ref_id = entry.get("ref_id", "")
        vec = note_embeddings.get(ref_id) if entry.get("kind") == "note" else None
        spent_call = False
        if vec is None:
            text = "\n".join(p for p in (entry.get("title", ""), entry.get("summary", "")) if p)
            vec = await _embed_with_retry(text)
            spent_call = True
        if vec is None:
            failed += 1
            log.warning("could not embed search_index entry %s", doc.id)
            continue

        await doc.reference.set({"embedding": vec}, merge=True)
        fixed += 1
        log.info("embedded search_index entry %s (reused note vector: %s)", doc.id, not spent_call)
        if spent_call and delay:
            await asyncio.sleep(delay)

    return scanned, missing, fixed, failed


async def run(dry_run: bool, user_id: str | None, per_minute: int) -> None:
    db = get_db()
    delay = 60.0 / per_minute if per_minute > 0 else 0.0
    per_user: dict[str, dict[str, int]] = defaultdict(lambda: {"notes_missing": 0,
                                                                "search_index_missing": 0})

    n_scanned, n_missing, n_fixed, n_failed, fresh = await _fix_notes(
        db, dry_run, user_id, delay, per_user)
    s_scanned, s_missing, s_fixed, s_failed = await _fix_search_index(
        db, dry_run, user_id, delay, per_user, fresh)

    if per_user:
        log.info("per-user missing-embedding counts:")
        for uid, counts in sorted(per_user.items()):
            if counts["notes_missing"] or counts["search_index_missing"]:
                log.info("  %s: notes=%d search_index=%d",
                         uid, counts["notes_missing"], counts["search_index_missing"])

    scanned = n_scanned + s_scanned
    missing = n_missing + s_missing
    fixed = n_fixed + s_fixed
    failed = n_failed + s_failed
    log.info("done: scanned=%d missing=%d fixed=%d failed=%d "
             "(notes: missing=%d fixed=%d failed=%d; search_index: missing=%d fixed=%d failed=%d)%s",
             scanned, missing, fixed, failed,
             n_missing, n_fixed, n_failed, s_missing, s_fixed, s_failed,
             " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="write changes (default is dry-run: report counts, write nothing)")
    parser.add_argument("--user-id", help="only backfill one user")
    parser.add_argument("--per-minute", type=int, default=DEFAULT_PER_MINUTE,
                        help=f"pace re-embeds (default {DEFAULT_PER_MINUTE}/min — quota is tiny)")
    args = parser.parse_args()
    asyncio.run(run(dry_run=not args.apply, user_id=args.user_id, per_minute=args.per_minute))
