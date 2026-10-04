"""Re-embed every note's `embedding` (title + summary + data excerpt) with the current embed model.

Run after changing EMBED_MODEL / EMBED_TEXT_VERSION (old vectors are incompatible). Skips notes
already at the current version. Dry-run by default.

    python -m scripts.reindex_embeddings                 # dry-run
    python -m scripts.reindex_embeddings --apply [--user-id UID] [--per-minute 60]
"""
import argparse
import asyncio
import logging

from google.cloud.firestore_v1.vector import Vector

from services.embeddings import EMBED_TEXT_VERSION, embedding_service, note_embedding_text
from services.firebase import get_db

log = logging.getLogger("clipnote.reindex_embeddings")


async def main(apply: bool, user_id: str | None, per_minute: int) -> None:
    db = get_db()
    query = db.collection("notes")
    if user_id:
        query = query.where("user_id", "==", user_id)
    done = skipped = failed = 0
    todo = []  # collect first so the Firestore stream isn't held open across the throttle sleeps
    async for doc in query.stream():
        d = doc.to_dict() or {}
        if (d.get("embedding_version") or 0) >= EMBED_TEXT_VERSION:
            skipped += 1
            continue
        text = note_embedding_text(d.get("title", ""), d.get("ai_summary", ""), d.get("data"))
        if not text:
            skipped += 1
            continue
        todo.append((doc, text))
    for doc, text in todo:
        if apply:
            try:
                vec = await embedding_service.embed_document(text)
                await doc.reference.update(
                    {"embedding": Vector(vec), "embedding_version": EMBED_TEXT_VERSION})
            except Exception as e:  # noqa: BLE001 — keep going; rerun picks up the rest
                log.warning("note %s failed: %s: %s", doc.id, type(e).__name__, e)
                failed += 1
                continue
            await asyncio.sleep(60 / per_minute)
        done += 1
    print(f"{'re-embedded' if apply else 'would re-embed'}={done} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--user-id")
    ap.add_argument("--per-minute", type=int, default=60)
    a = ap.parse_args()
    asyncio.run(main(a.apply, a.user_id, a.per_minute))
