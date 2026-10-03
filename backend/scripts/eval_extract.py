"""Eval gate for the OpenRouter cutover: run the real capture pipeline (resolve → classify →
extract) on ~10 real URLs and print each note for judging BY HAND before cutover.

No Firestore writes, no Cloud Tasks — just the AI path. Needs OPENROUTER_API_KEY (and
APIFY_TOKEN for reels/carousels if yt-dlp is blocked from your IP).

    cd backend
    OPENROUTER_API_KEY=sk-or-... .venv/bin/python -m scripts.eval_extract            # defaults
    OPENROUTER_API_KEY=sk-or-... .venv/bin/python -m scripts.eval_extract URL [URL…]
    # YouTube text-fallback path: force both YouTube attempts to fail (bogus model id) so the
    # third attempt (TEXT_MODEL, title + description only) runs:
    OPENROUTER_API_KEY=sk-or-... .venv/bin/python -m scripts.eval_extract --yt-fallback \
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    # --out evals.jsonl writes one JSON line per URL for side-by-side comparison across models.

Judge each note: is it clearly better than the source? Exact values (quantities, prices) kept,
nothing fabricated, right content_type, data shaped for its template. Per-URL cost comes from
OpenRouter's billed `usage.cost` — check the YouTube rows (no low-media-resolution knob).
"""
import argparse
import asyncio
import json
import time

from config import settings
from services import sources
from services.gemini import gemini_service
from services.usage_meter import start_metering

DEFAULT_URLS = [
    "https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/",   # recipe (JSON-LD)
    "https://www.amazon.com/dp/B09B8V1LZ3",                                   # product (bot-walled)
    "https://paulgraham.com/greatwork.html",                                   # long article
    "https://en.wikipedia.org/wiki/Cold_brew_coffee",                          # reference article
    "https://www.lonelyplanet.com/articles/best-things-to-do-in-lisbon",       # places/travel
    "https://www.reddit.com/r/Cooking/top/?t=year",                            # discussion
    "https://www.instagram.com/reel/DY-NgVLtlnV/",                             # reel
    "https://www.instagram.com/p/DY6zt0_DE3v/",                                # carousel
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",                             # YouTube public
    "https://www.youtube.com/shorts/aqz-KE-bpKQ",                              # YouTube Short
]


async def eval_one(url: str) -> dict:
    meter = start_metering()
    t0 = time.monotonic()
    row: dict = {"url": url}
    try:
        bundle = await sources.acquire(url)
        row.update(strategy=bundle.strategy, kind=bundle.kind,
                   images=len(bundle.image_parts), video_uri=bundle.video_uri)
        row["content_type"] = await gemini_service.classify(url, bundle, [])
        note = await gemini_service.extract_async(url, bundle, row["content_type"])
        row.update(title=note.title, ai_summary=note.ai_summary, data=note.data)
    except Exception as e:  # noqa: BLE001 — report and move on to the next URL
        row["error"] = f"{type(e).__name__}: {e}"
    row["models"] = {m: tokens for m, tokens in meter.by_model.items()}
    row["cost_usd"] = round(meter.cost_usd, 6)
    row["seconds"] = round(time.monotonic() - t0, 1)
    return row


async def main(urls: list[str], out: str | None) -> None:
    rows = []
    for url in urls:
        row = await eval_one(url)
        rows.append(row)
        print("=" * 100)
        print(json.dumps(row, ensure_ascii=False, indent=2, default=str))
    print("=" * 100)
    for r in rows:
        status = "ERR " + r["error"][:60] if "error" in r else r.get("content_type", "")
        print(f"{r['cost_usd']:>10.6f}$ {r['seconds']:>6}s  {status:<40} {r['url']}")
    print(f"total ${sum(r['cost_usd'] for r in rows):.4f}")
    if out:
        with open(out, "w") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--yt-fallback", action="store_true",
                    help="bogus YOUTUBE_MODEL so the TEXT_MODEL fallback runs")
    ap.add_argument("--out", help="write JSONL results here")
    args = ap.parse_args()
    if not settings.OPENROUTER_API_KEY:
        raise SystemExit("OPENROUTER_API_KEY is not set")
    if args.yt_fallback:
        settings.YOUTUBE_MODEL = "google/does-not-exist"
    asyncio.run(main(args.urls or DEFAULT_URLS, args.out))
