"""One-off backfill: regenerate ai_summary for notes stuck with a migration-artifact summary.

The items→notes fold (migrate_items_to_notes.py) left some notes with a summary like
"Added 37 items to your Places collection." / "Added 1 item to your Places collection." instead
of a real one — these pollute cards, note details, and the embeddings built from them (the
summary text feeds both search_index and the note's own semantic-search vector).

For each matching note: ask the lite model for a proper 1-2 sentence summary from the note's own
STORED title + data (no re-scrape — see `gemini_service.summarize_for_backfill`), update
`ai_summary`, and re-upsert the search_index entry + the note's embedding through the exact same
helper production ingest uses (`services.search_index.upsert_for_note`), so this never drifts from
the real write path.

Embed-quota reality (text-embedding-005 QPM is tiny — see memory): re-embeds are paced at
`--per-minute` (default 15), retried once on failure, and merge-preserve the note's EXISTING
vector when the retry also fails — a summary fix must never regress an already-searchable note to
unembedded.

Idempotent: a note whose (possibly regenerated) summary no longer matches the artifact pattern is
simply not selected on the next run.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_summaries                          # dry-run (default)
    python -m scripts.backfill_summaries --apply
    python -m scripts.backfill_summaries --apply --user-id UID
    python -m scripts.backfill_summaries --apply --limit 50
    python -m scripts.backfill_summaries --apply --per-minute 20
"""
import argparse
import asyncio
import logging
import re
from datetime import datetime, timezone

from google.cloud.firestore_v1.vector import Vector

from services import search_index
from services.embeddings import embedding_service
from services.firebase import get_db
from services.gemini import gemini_service

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_summaries")

DEFAULT_PER_MINUTE = 15

# "Added 37 items to your Places collection." / "Added 1 item to your Trips collection."
_MIGRATION_ARTIFACT_RE = re.compile(r"^Added \d+ items? to your .+ collection\.$")


def is_migration_artifact_summary(summary) -> bool:
    """True for the leftover mini-app-fanout summaries migrate_items_to_notes.py wrote in place
    of a real one. Pure — safe to unit test without Firestore."""
    return isinstance(summary, str) and bool(_MIGRATION_ARTIFACT_RE.match(summary.strip()))


async def _reembed(text: str, existing: Vector | None) -> tuple[Vector | None, bool]:
    """Embed `text`, retrying once on failure. Returns (vector, attempted) — `attempted` is True
    whenever a real embed call was made (success or not), so the caller can still pace on it.
    Falls back to `existing` (merge-preserve) when both attempts fail or return nothing."""
    if not text.strip():
        return existing, False
    attempted = False
    for attempt in range(2):
        attempted = True
        try:
            vec = await embedding_service.embed_document(text)
            if vec:
                return Vector(vec), attempted
            break
        except Exception as e:  # noqa: BLE001 — quota/transient errors get one retry.
            log.warning("embed attempt %d failed: %s: %s", attempt + 1, type(e).__name__, e)
            if attempt == 0:
                await asyncio.sleep(2.0)
    return existing, attempted


async def run(dry_run: bool, user_id: str | None, limit: int | None, per_minute: int) -> None:
    db = get_db()
    delay = 60.0 / per_minute if per_minute > 0 else 0.0

    query = db.collection("notes")
    if user_id:
        query = query.where("user_id", "==", user_id)

    scanned = matched = processed = updated = failed = 0

    async for doc in query.stream():
        scanned += 1
        note = doc.to_dict() or {}
        if not is_migration_artifact_summary(note.get("ai_summary")):
            continue
        matched += 1
        if limit is not None and processed >= limit:
            continue
        processed += 1

        log.info("match: note %s (user=%s) summary=%r",
                 doc.id, note.get("user_id"), note.get("ai_summary"))
        if dry_run:
            continue

        new_summary = await gemini_service.summarize_for_backfill(
            note.get("title", ""), note.get("content_type", ""), note.get("data") or {})
        if not new_summary:
            failed += 1
            log.warning("skipping note %s: summary regeneration failed", doc.id)
            continue

        text = "\n".join(p for p in (note.get("title", ""), new_summary) if p).strip()
        embedding, attempted = await _reembed(text, note.get("embedding"))

        patch: dict = {"ai_summary": new_summary, "updated_at": datetime.now(timezone.utc)}
        if embedding is not None:
            patch["embedding"] = embedding
        await doc.reference.set(patch, merge=True)

        merged_note = {**note, **patch}
        await search_index.upsert_for_note(db, doc.id, merged_note, embedding)
        updated += 1
        log.info("updated note %s -> %r", doc.id, new_summary)

        if attempted and delay:
            await asyncio.sleep(delay)

        if scanned % 50 == 0:
            log.info("progress: scanned=%d matched=%d updated=%d failed=%d",
                     scanned, matched, updated, failed)

    log.info("done: scanned=%d matched=%d updated=%d failed=%d%s",
             scanned, matched, updated, failed, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="write changes (default is dry-run: log matches, write nothing)")
    parser.add_argument("--user-id", help="only backfill one user")
    parser.add_argument("--limit", type=int, default=None,
                        help="cap how many matching notes are processed this run")
    parser.add_argument("--per-minute", type=int, default=DEFAULT_PER_MINUTE,
                        help=f"pace re-embeds (default {DEFAULT_PER_MINUTE}/min — quota is tiny)")
    args = parser.parse_args()
    asyncio.run(run(dry_run=not args.apply, user_id=args.user_id, limit=args.limit,
                    per_minute=args.per_minute))
