"""YouTube: transcript-first, with the model reading the URL itself when that's cheaper/only way.

Google fetches the video for YOUTUBE_MODEL, not our IP, so direct analysis is the reliable path.
One 8 s watch-page fetch (`ytInitialPlayerResponse`) supplies duration, title, description and
caption-track URLs; oEmbed is the fallback when the page is blocked. Routing:
  <= 180 s (Shorts)                 -> youtube_direct (YOUTUBE_MODEL reads the URL, ~$0.002)
  longer + transcript >= 200 chars  -> youtube_transcript (text bundle, TEXT_MODEL)
  longer, no transcript, <= MAX     -> youtube_direct
  longer than MAX_VIDEO_SECONDS     -> Apify subtitles, else description-only text
"""
import html
import json as _json
import logging
import re
from urllib.parse import urlparse

import httpx

from config import settings
from models.note import ContentBundle

log = logging.getLogger("clipnote.sources")

_DOMAINS = ("youtube.com", "youtu.be", "music.youtube.com")
SHORT_SECONDS = 180
MIN_TRANSCRIPT_CHARS = 200
PAGE_TIMEOUT_SECONDS = 8.0
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
       "Chrome/124.0 Safari/537.36")
_VIDEO_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/|embed/|live/))([\w-]{11})"
)


def matches(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in _DOMAINS)


def _parse_player_response(page: str) -> dict | None:
    """Pull `ytInitialPlayerResponse` out of watch-page HTML (raw_decode: no regex over JSON)."""
    marker = page.find("ytInitialPlayerResponse")
    start = page.find("{", marker) if marker != -1 else -1
    if start == -1:
        return None
    try:
        pr, _ = _json.JSONDecoder().raw_decode(page[start:])
    except ValueError:
        return None
    vd = pr.get("videoDetails") or {}
    if not vd:
        return None
    thumbs = (vd.get("thumbnail") or {}).get("thumbnails") or []
    tracks = ((pr.get("captions") or {}).get("playerCaptionsTracklistRenderer") or {}).get(
        "captionTracks") or []
    return {
        "duration": int(vd.get("lengthSeconds") or 0),
        "title": vd.get("title"),
        "author": vd.get("author"),
        "thumbnail": thumbs[-1].get("url") if thumbs else None,
        "description": (vd.get("shortDescription") or "")[:4000],
        "tracks": tracks,
    }


async def _watch_page(vid: str) -> dict | None:
    # Fixed host (youtube.com) — no SSRF surface.
    async with httpx.AsyncClient(timeout=PAGE_TIMEOUT_SECONDS, follow_redirects=True) as client:
        resp = await client.get("https://www.youtube.com/watch", params={"v": vid},
                                headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9",
                                         "Cookie": "CONSENT=YES+1"})
    resp.raise_for_status()
    return _parse_player_response(resp.text)


async def _oembed(url: str) -> dict:
    """Metadata fallback when the watch page is blocked: public oEmbed, no auth, not bot-gated."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get("https://www.youtube.com/oembed",
                                params={"url": url, "format": "json"})
    resp.raise_for_status()
    return resp.json()


def _captions_text(raw: str) -> str:
    try:  # json3
        events = _json.loads(raw).get("events", [])
        return "".join(seg.get("utf8", "") for ev in events for seg in (ev.get("segs") or []))
    except ValueError:  # XML (<text ...>line</text>)
        return " ".join(html.unescape(m) for m in re.findall(r"<text[^>]*>(.*?)</text>", raw, re.S))


async def _fetch_transcript(tracks: list[dict]) -> str | None:
    """English-ish caption track -> plain text. Best-effort: timedtext may need signed params
    that datacenter IPs don't get; any failure just means 'no transcript'."""
    track = next((t for t in tracks if str(t.get("languageCode", "")).startswith("en")),
                 tracks[0] if tracks else None)
    base = (track or {}).get("baseUrl") or ""
    host = urlparse(base).hostname or ""
    if not (host == "youtube.com" or host.endswith(".youtube.com")):
        return None
    try:
        async with httpx.AsyncClient(timeout=PAGE_TIMEOUT_SECONDS) as client:
            resp = await client.get(base + ("" if "fmt=" in base else "&fmt=json3"))
        resp.raise_for_status()
        text = " ".join(_captions_text(resp.text).split())
    except Exception as e:
        log.info("youtube transcript fetch failed: %s", str(e)[:120])
        return None
    return text[:28000] or None


async def _apify_subtitles(url: str) -> str | None:
    """>MAX_VIDEO_SECONDS with no free transcript: one capped Apify call for subtitles."""
    from services import apify
    from services.firebase import reserve_apify_slot

    if not settings.APIFY_TOKEN or apify.actor_kind(url) is None or not await reserve_apify_slot():
        return None
    result = await apify.fetch(url)
    return (result or {}).get("subtitles") or None


async def acquire(url: str) -> ContentBundle:
    vid = m.group(1) if (m := _VIDEO_ID_RE.search(url)) else None
    page = None
    if vid:
        try:
            page = await _watch_page(vid)
        except Exception as e:
            log.info("watch page failed (%s); falling back to oEmbed", str(e)[:120])
    if page is None:
        page = {"duration": 0, "tracks": [], "description": "",
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/maxresdefault.jpg" if vid else None}
        try:
            oe = await _oembed(url)
            page.update(title=oe.get("title"), author=oe.get("author_name"))
        except Exception as e:
            log.warning("oEmbed also failed: %s", e)

    duration = page["duration"]
    metadata = {
        "title": page.get("title") or "Untitled",
        "author": page.get("author"),
        "platform": "youtube",
        "duration": duration,
        "description": page.get("description") or "",
    }
    images = [page["thumbnail"]] if page.get("thumbnail") else []

    def text_bundle(text: str, via: str) -> ContentBundle:
        return ContentBundle(kind="text", text=text, images=images,
                             metadata={**metadata, "via": via}, strategy="youtube_transcript")

    def direct() -> ContentBundle:
        return ContentBundle(kind="video_uri", video_uri=url, images=images, metadata=metadata,
                             strategy="youtube_direct")

    if not duration and "/shorts/" not in url:  # page blocked, length unknown: don't risk a
        return text_bundle(metadata["description"] or metadata["title"], "description")  # long video
    if duration <= SHORT_SECONDS:  # Shorts, or an unknown-length /shorts/ link
        return direct()
    transcript = await _fetch_transcript(page["tracks"]) if page["tracks"] else None
    if transcript and len(transcript) >= MIN_TRANSCRIPT_CHARS:
        return text_bundle(transcript, "captions")
    if duration <= settings.MAX_VIDEO_SECONDS:
        return direct()
    if subs := await _apify_subtitles(url):
        return text_bundle(subs, "apify")
    return text_bundle(metadata["description"] or metadata["title"], "description")
