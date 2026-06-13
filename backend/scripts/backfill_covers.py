"""One-off backfill to fix note covers, mirroring the worker's own chain. Two tiers:

  1. RE-HOST (free): a note whose cover points at an external URL (e.g. an Instagram
     CDN thumbnail) gets the real image copied into our durable covers bucket via
     persist_cover — preserving the actual cover before the hot-linked, time-signed URL
     expires and the note goes blank. New captures already do this; old ones predate it.

  2. GENERATE (paid): a note with no cover at all, or whose external cover is already
     dead/unfetchable, gets an Imagen cover (the frontend gradient hero is the fallback
     if generation is off/fails).

Idempotent: notes already on a durable covers-bucket URL are skipped. Re-hosting is free
and on by default; Imagen is paid, so it only runs with --apply, can be turned off with
--no-imagen, and is bounded by --limit. Bypasses the live per-user/global daily caps
(those rate-limit ingest). Force-enables generation in-process, so it works even while
the live service keeps ENABLE_IMAGEN=false.

Imagen prereqs: IMAGEN_MODEL + region verified against the live Vertex catalog, a quota
increase, and COVERS_BUCKET set. Run from backend/ with ADC pointing at the project.

Usage:
    python -m scripts.backfill_covers                       # dry run: plan + cost estimate
    python -m scripts.backfill_covers --apply               # re-host + generate
    python -m scripts.backfill_covers --apply --no-imagen   # only re-host (free, no spend)
    python -m scripts.backfill_covers --apply --limit 20    # cap Imagen generations
    python -m scripts.backfill_covers --apply --user <uid>
"""
import argparse
import asyncio
import logging
from datetime import datetime, timezone

from google.cloud.firestore_v1 import Increment

from config import settings
from services.covers import persist_cover
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


def _is_durable(url: str | None) -> bool:
    return bool(url) and settings.COVERS_BUCKET and settings.COVERS_BUCKET in url


async def run(apply: bool, limit: int, user: str | None, do_imagen: bool) -> None:
    if apply:
        # Operator deliberately ran a backfill — generate regardless of the live flag.
        settings.ENABLE_IMAGEN = do_imagen
        if not settings.COVERS_BUCKET:
            log.error("COVERS_BUCKET is not set — cannot store covers. Aborting.")
            return

    db = get_db()
    col = db.collection("notes")
    query = col.where("user_id", "==", user) if user else col

    scanned = durable = rehost_n = rehost_done = imagen_n = imagen_done = failed = 0
    async for doc in query.stream():
        scanned += 1
        d = doc.to_dict() or {}
        url = d.get("cover_image_url")

        if _is_durable(url):
            durable += 1
            continue

        # Tier 1 — external cover still present: try to re-host it durably (free).
        if url:
            rehost_n += 1
            if apply:
                try:
                    new = await persist_cover(url)
                    if new:
                        await doc.reference.update(
                            {"cover_image_url": new, "updated_at": datetime.now(timezone.utc)}
                        )
                        rehost_done += 1
                        log.info("re-hosted %s → %s", doc.id, new)
                        continue
                    # persist_cover returned None → source is dead/unfetchable; fall to Imagen.
                    log.info("re-host failed for %s (dead source) → generating", doc.id)
                except Exception as e:  # noqa: BLE001
                    log.warning("re-host error %s: %s: %s", doc.id, type(e).__name__, e)
            else:
                continue  # dry run: counted as a re-host candidate

        # Tier 2 — no cover (or re-host just failed): generate one with Imagen (paid).
        imagen_n += 1
        if not (apply and do_imagen):
            continue
        if limit and imagen_done >= limit:
            continue
        try:
            gen = await generate_cover(_cover_prompt(d), d.get("content_type", ""))
            if not gen:
                failed += 1
                log.warning("no cover generated for %s (filtered/empty)", doc.id)
                continue
            await doc.reference.update(
                {"cover_image_url": gen, "updated_at": datetime.now(timezone.utc)}
            )
            await record_image_generated(d.get("user_id", ""))
            imagen_done += 1
            log.info("generated %s → %s", doc.id, gen)
        except Exception as e:  # noqa: BLE001
            failed += 1
            log.warning("generate error %s: %s: %s", doc.id, type(e).__name__, e)

    if apply and imagen_done:
        await _bump_daily(db, imagen_done)

    if not apply:
        gen_count = min(limit, imagen_n) if limit else imagen_n
        est = (gen_count if do_imagen else 0) * settings.IMAGEN_PRICE_PER_IMAGE
        log.info(
            "DRY RUN: scanned=%d  already-durable=%d  to re-host (free)=%d  "
            "to generate%s=%d  → est. cost ≈ $%.2f. Re-run with --apply.",
            scanned, durable, rehost_n, "" if do_imagen else " (disabled)", gen_count, est,
        )
    else:
        log.info("done: scanned=%d durable=%d re-hosted=%d generated=%d failed=%d",
                 scanned, durable, rehost_done, imagen_done, failed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="actually write (default is a dry-run plan + cost estimate)")
    parser.add_argument("--no-imagen", action="store_true",
                        help="only re-host external covers durably; skip paid Imagen generation")
    parser.add_argument("--limit", type=int, default=0,
                        help="max Imagen covers to generate this run (0 = no limit)")
    parser.add_argument("--user", default=None, help="restrict to one user uid")
    args = parser.parse_args()
    asyncio.run(run(args.apply, args.limit, args.user, do_imagen=not args.no_imagen))
