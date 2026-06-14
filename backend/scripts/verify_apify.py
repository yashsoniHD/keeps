"""Live end-to-end verification of the Apify scraper integration.

Runs the REAL per-platform actors against real URLs and prints, for each:
  URL → routed kind → actor id → input JSON → HTTP status → raw output keys →
  normalized dict (what our code extracts) → how it would feed Gemini (video vs text).

This is the check the unit tests CAN'T do — they use synthetic payloads. Run it with the
live token to confirm the documented input/output shapes match reality:

    cd backend
    APIFY_TOKEN=apify_api_xxx ./venv/bin/python -m scripts.verify_apify \
        "https://www.instagram.com/reel/XXXX/" "https://www.tiktok.com/@u/video/123"

With no URLs it uses a couple of known Instagram defaults. Costs one paid scrape per URL.
"""
import asyncio
import json
import sys

import httpx

from config import settings
from services import apify

_DEFAULT_URLS = [
    "https://www.instagram.com/reel/DY-NgVLtlnV/",
    "https://www.instagram.com/p/DY6zt0_DE3v/",
]


def _trunc(v):
    return v[:80] + "…" if isinstance(v, str) and len(v) > 80 else v


async def check(url: str) -> None:
    print(f"\n=== {url}")
    kind = apify._url_kind(url)
    actor = apify._registry().get(kind)
    print(f"  routed kind : {kind}")
    print(f"  actor       : {actor.actor_id if actor else '(none configured → og-caption fallback)'}")
    if not actor:
        return
    payload = actor.build_input(url)
    print(f"  input json  : {json.dumps(payload)}")

    endpoint = apify._RUN_SYNC.format(actor=actor.actor_id)
    with httpx.Client(timeout=180.0) as client:
        resp = client.post(endpoint, params={"token": settings.APIFY_TOKEN}, json=payload)
    items = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None
    print(f"  http        : {resp.status_code}  items={len(items) if isinstance(items, list) else 'n/a'}")
    if resp.status_code >= 300:  # run-sync returns 201 on success
        print(f"  body        : {resp.text[:300]}")
        return
    if not isinstance(items, list) or not items:
        print("  ⚠️  empty result — actor returned no items for this URL (input shape wrong?)")
        return

    print(f"  raw keys    : {sorted(items[0].keys())}")
    norm = apify._normalize(items[0])
    print(f"  normalized  : {json.dumps({k: _trunc(v) for k, v in norm.items()}, ensure_ascii=False)}")
    feed = "VIDEO → download → gs:// → Gemini video analysis" if norm["video_url"] \
        else "TEXT (caption only) → Gemini text analysis"
    print(f"  gemini feed : {feed}")
    if not norm["video_url"]:
        print("  ⚠️  no video_url resolved — check _VIDEO_FIELDS vs the raw keys above")


async def main() -> None:
    if not settings.APIFY_TOKEN:
        sys.exit("APIFY_TOKEN not set in env — export it and re-run.")
    urls = sys.argv[1:] or _DEFAULT_URLS
    for u in urls:
        try:
            await check(u)
        except Exception as e:  # noqa: BLE001 — diagnostic script, surface everything
            print(f"  ERROR       : {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
