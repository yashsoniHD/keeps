"""One-off: before the covers bucket is deleted, rewrite every note cover that points at
storage.googleapis.com to the source page's og:image (or None if there isn't one), and mirror
the change into search_index/note-{id}. Idempotent: notes already off GCS are skipped.

Usage (from backend/):
    python -m scripts.rewrite_cover_urls                 # dry run
    python -m scripts.rewrite_cover_urls --apply
    python -m scripts.rewrite_cover_urls --apply --user <uid> --limit 50
"""
import argparse
import asyncio
import logging
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from services.firebase import get_db
from services.net_guard import guarded_async_client

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.rewrite_covers")

_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
_BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
_DELAY = 0.5  # ~2 fetches/s


async def _og_image(page_url: str) -> str | None:
    """og:image / twitter:image of the page, or None on any miss or failure."""
    ua = _CRAWLER_UA if "instagram.com" in page_url else _BROWSER_UA
    try:
        async with guarded_async_client(follow_redirects=True, timeout=15) as client:
            resp = await client.get(page_url, headers={"User-Agent": ua})
            resp.raise_for_status()
    except Exception as e:  # noqa: BLE001
        log.warning("fetch failed %s: %s: %s", page_url, type(e).__name__, e)
        return None
    soup = BeautifulSoup(resp.text, "html.parser")
    for attr, name in (("property", "og:image"), ("name", "twitter:image"), ("property", "twitter:image")):
        tag = soup.find("meta", attrs={attr: name})
        content = (tag.get("content") or "").strip() if tag else ""
        if content.startswith("http") and "storage.googleapis.com" not in content:
            return content
    return None


async def run(apply: bool, user: str | None, limit: int) -> dict:
    db = get_db()
    col = db.collection("notes")
    query = col.where("user_id", "==", user) if user else col
    stats = {"rewritten": 0, "nulled": 0, "skipped": 0}
    handled = 0
    async for doc in query.stream():
        d = doc.to_dict() or {}
        if "storage.googleapis.com" not in (d.get("cover_image_url") or ""):
            stats["skipped"] += 1
            continue
        if limit and handled >= limit:
            break
        handled += 1
        new = await _og_image(d["source_url"]) if d.get("source_url") else None
        stats["rewritten" if new else "nulled"] += 1
        log.info("%s %s: %s -> %s", "APPLY" if apply else "DRY", doc.id, d["cover_image_url"], new)
        if apply:
            await doc.reference.update({"cover_image_url": new, "updated_at": datetime.now(timezone.utc)})
            idx = db.collection("search_index").document(f"note-{doc.id}")
            if (await idx.get()).exists:
                await idx.update({"cover_image_url": new})
        await asyncio.sleep(_DELAY)
    log.info("%s: rewritten=%d nulled=%d skipped=%d", "done" if apply else "DRY RUN (use --apply)",
             stats["rewritten"], stats["nulled"], stats["skipped"])
    return stats


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    p.add_argument("--user", default=None, help="restrict to one user uid")
    p.add_argument("--limit", type=int, default=0, help="max notes to rewrite (0 = all)")
    a = p.parse_args()
    asyncio.run(run(a.apply, a.user, a.limit))
