"""One-off backfill: re-embed notes under the v2 recipe (title + summary + flattened `data`).

Search used to embed only title + ai_summary, so a query could match a note's headline but never
its body (ingredients, steps, listicle entries, specs). `services.embeddings.note_embedding_text`
now folds a `data` excerpt into the vector, and every fresh save stamps
`embedding_version = EMBED_TEXT_VERSION`. This script upgrades notes saved before that.

Strategy:
  - Pass 1 (one embed call per note): stream `notes` (optionally one user); skip docs already at
    `embedding_version >= EMBED_TEXT_VERSION`; for the rest re-embed from `note_embedding_text`
    (paced, retried once), write `{embedding, embedding_version}` back, and re-upsert search_index
    through the SAME helper production uses (`upsert_for_note`) with the fresh vector — so the note
    doc and its index entry stay the same single vector.
  - Pass 2 (zero embed calls): `search_index` docs with `kind == "note"` lacking a current
    `embedding_version` whose backing note is now v2 (fixed above, or already v2) — copy the note's
    stored vector + version onto the index doc. No embed spend.

Dry-run (default) reports counts per user without writing or embedding; --apply does the work,
paced at --per-minute (default 15 — text-embedding-005 QPM quota is tiny) with one retry.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_content_embeddings                  # dry-run (default)
    python -m scripts.backfill_content_embeddings --apply
    python -m scripts.backfill_content_embeddings --apply --user-id UID
    python -m scripts.backfill_content_embeddings --apply --per-minute 20
"""
import argparse
import asyncio
import logging
from collections import defaultdict

from google.cloud.firestore_v1.vector import Vector

from services import search_index
from services.embeddings import EMBED_TEXT_VERSION, embedding_service, note_embedding_text
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill_content_embeddings")

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
    """Re-embed notes below EMBED_TEXT_VERSION. Returns (scanned, stale, fixed, failed,
    {note_id: v2_embedding}) — the map covers every note that is v2 AFTER this pass (freshly
    fixed OR already v2), so pass 2 can reuse their vectors for free."""
    query = db.collection("notes")
    if user_id:
        query = query.where("user_id", "==", user_id)

    scanned = stale = fixed = failed = 0
    v2_embeddings: dict[str, Vector] = {}

    # Materialize the stream before the paced loop: the per-embed sleeps add up to minutes,
    # and a Firestore stream held open that long dies with DeadlineExceeded mid-run.
    docs = [doc async for doc in query.stream()]
    for doc in docs:
        scanned += 1
        note = doc.to_dict() or {}
        if (note.get("embedding_version") or 0) >= EMBED_TEXT_VERSION:
            # Already current — remember its vector so pass 2 can heal a lagging index entry.
            if note.get("embedding") is not None:
                v2_embeddings[doc.id] = note["embedding"]
            continue
        stale += 1
        per_user[note.get("user_id", "?")]["notes_stale"] += 1
        if dry_run:
            continue

        text = note_embedding_text(note.get("title", ""), note.get("ai_summary", ""),
                                   note.get("data"))
        vec = await _embed_with_retry(text)
        if vec is None:
            failed += 1
            log.warning("could not embed note %s (no usable text or embed failed)", doc.id)
            continue

        await doc.reference.set({"embedding": vec, "embedding_version": EMBED_TEXT_VERSION},
                                merge=True)
        merged = {**note, "embedding": vec, "embedding_version": EMBED_TEXT_VERSION}
        await search_index.upsert_for_note(db, doc.id, merged, vec)
        v2_embeddings[doc.id] = vec
        fixed += 1
        log.info("re-embedded note %s", doc.id)
        if delay:
            await asyncio.sleep(delay)

    return scanned, stale, fixed, failed, v2_embeddings


async def _fix_search_index(db, dry_run: bool, user_id: str | None, per_user: dict,
                            note_embeddings: dict[str, Vector]) -> tuple[int, int, int, int]:
    """Copy a v2 note's stored vector + version onto its index entry when the entry lags. Zero
    embed calls — an index doc with no v2 backing note is left alone (pass 1 already re-upserted
    the ones it fixed)."""
    query = db.collection("search_index").where("kind", "==", "note")
    if user_id:
        query = query.where("user_id", "==", user_id)

    scanned = stale = fixed = failed = 0

    docs = [doc async for doc in query.stream()]
    for doc in docs:
        scanned += 1
        entry = doc.to_dict() or {}
        if (entry.get("embedding_version") or 0) >= EMBED_TEXT_VERSION:
            continue
        vec = note_embeddings.get(entry.get("ref_id", ""))
        if vec is None:
            continue  # backing note isn't v2 yet — nothing to copy without an embed call
        stale += 1
        per_user[entry.get("user_id", "?")]["search_index_stale"] += 1
        if dry_run:
            continue
        await doc.reference.set({"embedding": vec, "embedding_version": EMBED_TEXT_VERSION},
                                merge=True)
        fixed += 1
        log.info("healed search_index entry %s from note vector", doc.id)

    return scanned, stale, fixed, failed


async def run(dry_run: bool, user_id: str | None, per_minute: int) -> None:
    db = get_db()
    delay = 60.0 / per_minute if per_minute > 0 else 0.0
    per_user: dict[str, dict[str, int]] = defaultdict(lambda: {"notes_stale": 0,
                                                               "search_index_stale": 0})

    n_scanned, n_stale, n_fixed, n_failed, v2 = await _fix_notes(
        db, dry_run, user_id, delay, per_user)
    s_scanned, s_stale, s_fixed, s_failed = await _fix_search_index(
        db, dry_run, user_id, per_user, v2)

    if per_user:
        log.info("per-user stale-embedding counts:")
        for uid, counts in sorted(per_user.items()):
            if counts["notes_stale"] or counts["search_index_stale"]:
                log.info("  %s: notes=%d search_index=%d",
                         uid, counts["notes_stale"], counts["search_index_stale"])

    log.info("done: notes scanned=%d stale=%d fixed=%d failed=%d; "
             "search_index scanned=%d stale=%d fixed=%d failed=%d%s",
             n_scanned, n_stale, n_fixed, n_failed,
             s_scanned, s_stale, s_fixed, s_failed,
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
