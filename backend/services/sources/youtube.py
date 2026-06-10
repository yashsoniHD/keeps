"""YouTube (shorts + long-form): direct Gemini video analysis via the URL.

No download, no scraping — Gemini natively ingests public YouTube URLs and sees both
visuals and audio (a recipe shown on screen but never spoken still gets extracted).
A metadata-only yt-dlp probe (no download) supplies title/duration/thumbnail and the
transcript used as fallback for videos over the duration cap.
"""
import asyncio
import json as _json
import re

import httpx
import yt_dlp

from config import settings
from models.note import ContentBundle

_DOMAINS = ("youtube.com", "youtu.be", "music.youtube.com")


def matches(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in _DOMAINS)


def _probe(url: str) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en.*"],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False) or {}


def _extract_transcript(info: dict) -> str | None:
    """Pulls manual or auto captions (English-ish) from yt-dlp info as plain text."""
    tracks = (info.get("subtitles") or {}) or (info.get("automatic_captions") or {})
    if not tracks:
        return None
    lang = next((l for l in tracks if l.startswith("en")), next(iter(tracks), None))
    if not lang:
        return None
    fmts = tracks[lang]
    pick = next((f for f in fmts if f.get("ext") in ("json3", "vtt", "srv1")), fmts[0] if fmts else None)
    if not pick or not pick.get("url"):
        return None
    try:
        raw = httpx.get(pick["url"], timeout=15.0).text
    except Exception:
        return None
    if pick.get("ext") == "json3":
        try:
            events = _json.loads(raw).get("events", [])
            words = [seg.get("utf8", "") for ev in events for seg in (ev.get("segs") or [])]
            text = "".join(words)
        except Exception:
            return None
    else:  # vtt/srt-ish: drop timestamp/index lines
        lines = [ln.strip() for ln in raw.splitlines()
                 if ln.strip() and "-->" not in ln and not ln.strip().isdigit()
                 and not ln.startswith(("WEBVTT", "Kind:", "Language:"))]
        text = " ".join(lines)
    text = text.strip()
    return text[:28000] if text else None


_VIDEO_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/|embed/|live/))([\w-]{11})"
)


async def _oembed(url: str) -> dict:
    """Metadata fallback when the yt-dlp probe is bot-blocked (datacenter IPs):
    YouTube's public oEmbed endpoint needs no auth and is not bot-gated."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get("https://www.youtube.com/oembed",
                                params={"url": url, "format": "json"})
    resp.raise_for_status()
    return resp.json()


async def acquire(url: str) -> ContentBundle:
    # The probe supplies duration (for the over-cap transcript fallback) and rich
    # metadata — but it is NOT load-bearing: Gemini ingests the URL directly. YouTube
    # bot-blocks yt-dlp on datacenter IPs, so a failed probe degrades to oEmbed
    # metadata + the direct path (duration unknown → cost is bounded by user caps).
    try:
        info = await asyncio.to_thread(_probe, url)
    except Exception as e:
        print(f"[youtube] probe blocked/failed ({str(e)[:120]}); falling back to oEmbed")
        info = {}
        try:
            oe = await _oembed(url)
            info = {"title": oe.get("title"), "uploader": oe.get("author_name")}
        except Exception as e2:
            print(f"[youtube] oEmbed also failed: {e2}")
        vid = m.group(1) if (m := _VIDEO_ID_RE.search(url)) else None
        if vid:
            info.setdefault("thumbnail", f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg")

    duration = int(info.get("duration") or 0)
    metadata = {
        "title": info.get("title") or "Untitled",
        "author": info.get("uploader") or info.get("creator"),
        "platform": "youtube",
        "duration": duration,
        "description": (info.get("description") or "")[:1000],
    }
    images = [t for t in [info.get("thumbnail")] if t]

    if duration and duration > settings.MAX_VIDEO_SECONDS:
        # Over the cap: transcript path (cheap) instead of full video tokens.
        transcript = await asyncio.to_thread(_extract_transcript, info)
        text = transcript or metadata["description"] or metadata["title"]
        return ContentBundle(
            kind="text", text=text, images=images, metadata=metadata,
            strategy="youtube_transcript",
        )

    return ContentBundle(
        kind="video_uri", video_uri=url, images=images, metadata=metadata,
        strategy="youtube_direct",
    )
