"""One-off backfill: generate an AI cover for existing notes that have no cover image.

New captures generate covers in the worker (process.py); this catches notes saved
before that, or whose source yielded no image. Idempotent — only touches notes still
missing `cover_image_url`.

PAID OPERATION. Each note is one Imagen image (~$IMAGEN_PRICE_PER_IMAGE). Unlike the
sibling backfill_embeddings (≈free), this defaults to a DRY RUN and prints a cost
estimate; you must pass --apply to actually generate. It bypasses the per-user/global
daily caps (those rate-limit live ingest) — control spend with --limit / --user instead.
It also force-enables generation in-process, so it works even while the live service
keeps ENABLE_IMAGEN=false.

Prereqs (same as enabling Imagen): IMAGEN_MODEL + region verified against the live Vertex
catalog, an Imagen quota increase, and COVERS_BUCKET set. Run from backend/ with ADC
pointing at the project.

Usage:
    python -m scripts.backfill_covers                  # dry run: count + cost estimate
    python -m scripts.backfill_covers --apply          # generate for ALL coverless notes
    python -m scripts.backfill_covers --apply --limit 20
    python -m scripts.backfill_covers --apply --user <uid>
"""
import argparse
import asyncio
import logging
from datetime import datetime, timezone

from google.cloud.firestore_v1 import Increment

from config import settings
from services.firebase import get_db, record_image_generated
from services.imagen import generate_cover

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.backfill")


def _cover_prompt(d: dict) -> str:
    """Build an Imagen prompt from a stored note. cover_image_prompt isn't persisted, so
    derive one from title + summary + type. 'No text' matters — Imagen otherwise renders
    garbled lettering."""
    ctype = (d.get("content_type") or "").replace("-", " ").strip()
    title = (d.get("title") or "").strip()
    summary = (d.get("ai_summary") or "").strip()[:240]
    subject = f" about {ctype}" if ctype else ""
    return (
        f"Editorial cover illustration for a saved note{subject}. "
        f"Subject: {title}. {summary} "
        "Clean, modern, evocative composition; no text, no words, no letters, no watermark."
    )


async def _bump_daily(db, n: int) -> None:
    """Reflect backfill spend in the admin 'images today' figure."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    try:
        await db.collection("system").document(f"usage-{today}").set(
            {"date": today, "image_count": Increment(n)}, merge=True
        )
    except Exception as e:  # noqa: BLE001
        log.warning("daily image meter bump failed: %s: %s", type(e).__name__, e)


async def run(apply: bool, limit: int, user: str | None) -> None:
    if apply:
        # Operator deliberately ran a backfill — generate regardless of the live flag.
        settings.ENABLE_IMAGEN = True
        if not settings.COVERS_BUCKET:
            log.error("COVERS_BUCKET is not set — cannot upload generated covers. Aborting.")
            return

    db = get_db()
    col = db.collection("notes")
    query = col.where("user_id", "==", user) if user else col

    scanned = eligible = generated = failed = 0
    async for doc in query.stream():
        scanned += 1
        d = doc.to_dict() or {}
        if d.get("cover_image_url"):
            continue
        eligible += 1
        if limit and generated >= limit:
            continue
        if not apply:
            continue
        try:
            url = await generate_cover(_cover_prompt(d), d.get("content_type", ""))
            if not url:
                failed += 1
                log.warning("no cover generated for note %s (filtered/empty)", doc.id)
                continue
            await doc.reference.update(
                {"cover_image_url": url, "updated_at": datetime.now(timezone.utc)}
            )
            await record_image_generated(d.get("user_id", ""))
            generated += 1
            log.info("note %s → %s", doc.id, url)
        except Exception as e:  # noqa: BLE001
            failed += 1
            log.warning("failed to backfill note %s: %s: %s", doc.id, type(e).__name__, e)

    if apply and generated:
        await _bump_daily(db, generated)

    if not apply:
        count = min(limit, eligible) if limit else eligible
        est = count * settings.IMAGEN_PRICE_PER_IMAGE
        log.info(
            "DRY RUN: scanned=%d coverless=%d — would generate %d, est. cost ≈ $%.2f. "
            "Re-run with --apply to generate.", scanned, eligible, count, est,
        )
    else:
        log.info("done: scanned=%d coverless=%d generated=%d failed=%d",
                 scanned, eligible, generated, failed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="actually generate (default is a dry-run cost estimate)")
    parser.add_argument("--limit", type=int, default=0,
                        help="max covers to generate this run (0 = no limit)")
    parser.add_argument("--user", default=None, help="restrict to one user uid")
    args = parser.parse_args()
    asyncio.run(run(args.apply, args.limit, args.user))
