"""One-off backfill: populate users/{uid}.sources from existing notes.

Run once after deploying the source-filter change. The ingest worker now records each
note's domain to users/{uid}.sources, but notes saved before then left that array empty —
so the feed's source filter still collapsed to the category-filtered window. This seeds
the array from the existing corpus. Idempotent — ArrayUnion only adds missing domains.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.backfill_sources
    python -m scripts.backfill_sources --dry-run
"""
import argparse
import asyncio
import logging
from collections import defaultdict

from google.cloud.firestore_v1 import ArrayUnion

from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill")


async def run(dry_run: bool) -> None:
    db = get_db()
    by_user: dict[str, set[str]] = defaultdict(set)
    scanned = 0

    async for doc in db.collection("notes").stream():
        scanned += 1
        d = doc.to_dict() or {}
        uid = d.get("user_id")
        domain = d.get("source_domain")
        if uid and domain:
            by_user[uid].add(domain)

    for uid, domains in by_user.items():
        sorted_domains = sorted(domains)
        if dry_run:
            log.info("would set %s.sources += %s", uid, sorted_domains)
            continue
        await db.collection("users").document(uid).set(
            {"sources": ArrayUnion(sorted_domains)}, merge=True
        )
        log.info("updated %s with %d sources", uid, len(sorted_domains))

    log.info("done: scanned=%d users=%d%s",
             scanned, len(by_user), " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="count work without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
