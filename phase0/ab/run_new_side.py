"""New-side A/B: run the real acquire → classify → extract pipeline on phase0/ab/links.txt.

REAL network + REAL OpenRouter/Apify spend, NO jobs/notes writes (acq_cache writes only;
acq_cache READS are bypassed so every link runs the full ladder). Mirrors routers/process.py
(`_extract` is called directly). v2: the REAL Apify slot reservation runs (system/usage-* apify_count).

Run: cd backend && .venv/bin/python ../phase0/ab/run_new_side.py [--limit N]
Writes phase0/ab/new_side_results_v2.json (the .md is written by hand from it).
"""
import asyncio
import contextvars
import json
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.getcwd())
from config import settings  # noqa: E402  (loads backend/.env)

import routers.process as process  # noqa: E402
import services.apify as apify  # noqa: E402
import services.sources.social_video as sv  # noqa: E402
from services import acq_cache, sources  # noqa: E402
from services.gemini import gemini_service, job_deadline  # noqa: E402
from services.url_utils import canonical_url  # noqa: E402
from services.usage_meter import start_metering  # noqa: E402

HERE = Path(__file__).parent
reencodes: list[dict] = []  # ffmpeg runs happen in threads; attributed by link below
BUDGET_USD = 2.0
CONCURRENCY = 1  # v2: sequential so latency is honest vs the 270 s budget

current = contextvars.ContextVar("current", default=None)  # per-link record dict


class _Events(logging.Handler):
    def emit(self, record):
        rec = current.get()
        if rec is None:
            return
        ev = getattr(record, "event", None)
        msg = record.getMessage()
        if ev:
            rec["events"].append(ev)
        if "video unreadable" in msg or "youtube unreadable" in msg:
            rec["events"].append("video_unreadable: " + msg[:200])
        if "timed out; retrying" in msg:
            rec["events"].append("client_timeout_retry")
        if "bad JSON" in msg:
            rec["events"].append("json_nudge")


def _install_hooks():
    h = _Events(level=logging.INFO)
    root = logging.getLogger("keeps")
    root.setLevel(logging.INFO)
    root.addHandler(h)

    real_fetch = apify.fetch

    async def counted_fetch(url):
        rec = current.get()
        t = time.monotonic()
        res = await real_fetch(url)
        if rec is not None:
            rec["apify_runs"] += 1
            rec["apify_s"] = round(time.monotonic() - t, 1)
            rec["apify_ok"] = bool(res)
        return res
    apify.fetch = counted_fetch

    real_get = acq_cache.get

    async def traced_get(url):
        d = await real_get(url)
        if (rec := current.get()) is not None and d:
            rec["acq_cache_hit_ignored"] = True
        return None  # bypass: measure the full ladder
    acq_cache.get = traced_get

    real_vid = process._extract_from_video

    async def traced_vid(bundle, video, mime, ct, *a, **k):
        if (rec := current.get()) is not None:
            rec["video_mb"] = round(len(video) / 1e6, 2)
        return await real_vid(bundle, video, mime, ct, *a, **k)
    process._extract_from_video = traced_vid

    real_dl = sv.download_video

    async def traced_dl(media_url, duration=0):
        r = await real_dl(media_url, duration)
        if (rec := current.get()) is not None:
            rec["downloads"].append({"host": media_url.split("/")[2][:40], "duration": duration,
                                     "ok": bool(r), "mb": round(len(r[0]) / 1e6, 2) if r else None})
        return r
    sv.download_video = traced_dl  # youtube.fallback imports it at call time too

    real_re = sv._reencode

    def traced_re(path, duration):
        size = os.path.getsize(path)
        out = real_re(path, duration)
        item = {"in_mb": round(size / 1e6, 2), "duration": duration,
                "out_mb": round(len(out) / 1e6, 2) if out else None}
        reencodes.append(item)
        if (rec := current.get()) is not None:  # to_thread copies the context
            rec["reencode"] = item
        return out
    sv._reencode = traced_re


async def run_one(url: str, spent: dict) -> dict:
    rec = {"url": url, "events": [], "apify_runs": 0, "downloads": []}
    current.set(rec)
    meter = start_metering()
    job_deadline.set(time.monotonic() + process.JOB_DEADLINE_S)
    t0 = time.monotonic()
    try:
        canon = canonical_url(url)
        bundle = await sources.acquire(canon)
        rec.update(acquire_s=round(time.monotonic() - t0, 1), strategy=bundle.strategy,
                   via=bundle.metadata.get("via"), kind=bundle.kind,
                   has_video_bytes=bool(bundle.metadata.get("video_bytes")),
                   image_parts=len(bundle.image_parts))
        if bundle.strategy == "private_or_blocked" or bundle.kind == "metadata_only":
            rec["outcome"] = "failed:private_or_blocked" if bundle.strategy == "private_or_blocked" \
                else "salvage:unreachable"
        else:
            ct = await gemini_service.classify(canon, bundle, [], None)
            rec["classified"] = ct
            extracted, bundle = await process._extract(canon, bundle, ct, None, [])
            md = bundle.metadata
            if md.get("thin") or md.get("too_long"):
                extracted.data["thin"] = True
            if md.get("too_long"):
                extracted.data["note"] = process.too_long_note(
                    md.get("duration") or 0, md.get("max_seconds") or settings.MAX_VIDEO_SECONDS,
                    md.get("built_from") or "caption")
            rec.update(too_long=bool(md.get("too_long")), duration=md.get("duration"))
            rec.update(final_strategy=bundle.strategy, thin=bool(extracted.data.get("thin")),
                       content_type=extracted.content_type, title=extracted.title,
                       summary=extracted.ai_summary,
                       data=json.loads(json.dumps(extracted.data, default=str)),
                       data_chars=len(json.dumps(extracted.data, default=str)),
                       outcome="note" if len(str(extracted.data)) >= 40 else "salvage:short_data")
    except Exception as e:  # noqa: BLE001
        rec["outcome"] = f"error:{type(e).__name__}: {str(e)[:300]}"
    rec["latency_s"] = round(time.monotonic() - t0, 1)
    rec["models"] = dict(meter.models)
    rec["cost_usd"] = round(meter.cost_usd, 6)
    rec["free_calls"] = sum(n for m, n in meter.models.items() if m.endswith(":free"))
    rec["paid_calls"] = sum(n for m, n in meter.models.items() if not m.endswith(":free"))
    rec["ig_embed_fallthrough"] = "ig_embed_fallthrough" in rec["events"]
    rec["youtube_fallback"] = "youtube_fallback" in rec["events"] or \
        str(rec.get("strategy", "")).startswith("youtube_fallback")
    rec["video_obtained"] = bool(rec.get("video_mb"))
    spent["usd"] += meter.cost_usd
    print(f"[{rec['latency_s']:>6}s ${rec['cost_usd']:.4f}] {rec.get('final_strategy') or rec.get('strategy')}"
          f" thin={rec.get('thin')} {rec['models']} {rec['outcome'][:60]} :: {url[:70]}", flush=True)
    return rec


async def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    links = [ln.strip() for ln in (HERE / "links.txt").read_text().splitlines() if ln.strip()]
    links = links[:limit] if limit else links
    _install_hooks()
    print("chains:", {k: getattr(settings, k) for k in
                      ("VIDEO_MODELS", "YOUTUBE_MODELS", "IMAGE_MODELS", "TEXT_MODELS",
                       "CLASSIFY_MODELS")}, flush=True)
    spent = {"usd": 0.0}
    results: list[dict] = []
    for i in range(0, len(links), CONCURRENCY):
        if spent["usd"] > BUDGET_USD:
            print(f"BUDGET STOP at ${spent['usd']:.3f}", flush=True)
            results += [{"url": u, "outcome": "skipped:budget"} for u in links[i:]]
            break
        batch = links[i:i + CONCURRENCY]
        results += await asyncio.gather(*(run_one(u, spent) for u in batch))
        (HERE / "new_side_results_v2.json").write_text(json.dumps(
            {"chains": {k: getattr(settings, k) for k in ("VIDEO_MODELS", "YOUTUBE_MODELS",
                        "IMAGE_MODELS", "TEXT_MODELS", "CLASSIFY_MODELS")},
             "total_cost_usd": round(spent["usd"], 4), "reencodes": reencodes,
             "results": results}, indent=1))
    print(f"TOTAL ${spent['usd']:.4f} over {len(results)} links", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
