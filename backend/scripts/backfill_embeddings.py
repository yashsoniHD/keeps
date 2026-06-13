"""One-off backfill: embed every existing note that has no `embedding` field yet.

Run once after deploying the embedding-at-ingest change, so notes saved before then
become searchable. Idempotent — re-running only touches notes still missing an embedding.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_embeddings
    python -m scripts.backfill_embeddings --dry-run
"""
import argparse
import asyncio
import logging

from google.cloud.firestore_v1.vector import Vector

from services.embeddings import embedding_service
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill")


async def run(dry_run: bool) -> None:
    db = get_db()
    scanned = embedded = skipped = failed = 0

    async for doc in db.collection("notes").stream():
        scanned += 1
        d = doc.to_dict() or {}
        if d.get("embedding") is not None:
            skipped += 1
            continue
        text = "\n".join(p for p in (d.get("title", ""), d.get("ai_summary", "")) if p).strip()
        if not text:
            skipped += 1
            continue
        if dry_run:
            embedded += 1
            continue
        try:
            vec = await embedding_service.embed_document(text)
            if not vec:
                failed += 1
                continue
            await doc.reference.update({"embedding": Vector(vec)})
            embedded += 1
        except Exception as e:
            failed += 1
            log.warning("failed to embed note %s: %s: %s", doc.id, type(e).__name__, e)
        if scanned % 50 == 0:
            log.info("progress: scanned=%d embedded=%d skipped=%d failed=%d",
                     scanned, embedded, skipped, failed)

    log.info("done: scanned=%d embedded=%d skipped=%d failed=%d%s",
             scanned, embedded, skipped, failed, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="count work without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
