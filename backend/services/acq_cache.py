"""6 h acquisition cache: scrape METADATA per canonical URL, so retries and the sweep don't
re-scrape or re-run Apify. Never bytes (1 MiB doc limit) — a retry re-downloads from the
cached media_url. Best-effort: any Firestore error is a miss / a skipped write."""
import hashlib
import logging
from datetime import datetime, timedelta, timezone

from services.firebase import get_db

log = logging.getLogger("keeps.acq_cache")

TTL = timedelta(hours=6)
FIELDS = ("caption", "comments", "media_url", "thumbnail", "images", "title", "author",
          "strategy", "via", "duration", "too_long")


def _ref(url: str):
    return get_db().collection("acq_cache").document(hashlib.sha256(url.encode()).hexdigest())


async def get(url: str) -> dict | None:
    try:
        snap = await _ref(url).get()
    except Exception as e:  # noqa: BLE001
        log.info("acq_cache read failed: %s", str(e)[:120])
        return None
    doc = snap.to_dict() if snap.exists else None
    cached_at = (doc or {}).get("cached_at")
    try:
        if datetime.now(timezone.utc) - cached_at > TTL:
            return None
    except TypeError:  # missing, naive or non-datetime cached_at → treat as a miss
        return None
    return doc


async def put(url: str, entry: dict) -> None:
    doc = {k: entry[k] for k in FIELDS if entry.get(k) is not None}
    doc["cached_at"] = datetime.now(timezone.utc)
    doc["expires_at"] = doc["cached_at"] + TTL  # for a Firestore TTL policy on this field
    try:
        await _ref(url).set(doc)
    except Exception as e:  # noqa: BLE001
        log.info("acq_cache write failed: %s", str(e)[:120])
