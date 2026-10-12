"""YouTube: the model watches the video directly; a fallback scraper takes over when it can't.

Primary: `youtube_direct` — YOUTUBE_MODEL reads the URL (Google fetches it, not our IP). One 8 s
watch-page fetch (`ytInitialPlayerResponse`, oEmbed fallback) supplies title/description/thumbnail
for classification plus the caption tracks the fallback needs.

When extraction raises `services.gemini.VideoUnreadable` (age/region/members-only, error) — or the
video is over settings.YOUTUBE_MAX_DIRECT_SECONDS — routers/process.py calls `fallback()`:
  captions from the watch page (free) → text bundle
  else the Apify YouTube actor: a direct mp4 → video bundle for the video model,
  else its subtitles → text bundle; else description + thumbnail (marked thin).
"""
import html
import json as _json
import logging
import re
from urllib.parse import urlparse

import httpx

from config import settings
from models.note import ContentBundle
from services.url_utils import host_matches

log = logging.getLogger("keeps.sources")

_DOMAINS = ("youtube.com", "youtu.be", "music.youtube.com")
MIN_TRANSCRIPT_CHARS = 200
PAGE_TIMEOUT_SECONDS = 8.0
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
       "Chrome/124.0 Safari/537.36")
_VIDEO_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/|embed/|live/))([\w-]{11})"
)


def matches(url: str) -> bool:
    return host_matches(url, _DOMAINS)


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


async def _metadata(url: str) -> tuple[dict, list[dict], str | None]:
    """(metadata, caption tracks, thumbnail) from the watch page, oEmbed when it's blocked."""
    vid = m.group(1) if (m := _VIDEO_ID_RE.search(url)) else None
    page = None
    if vid:
        try:
            page = await _watch_page(vid)
        except Exception as e:  # noqa: BLE001
            log.info("watch page failed (%s); falling back to oEmbed", str(e)[:120])
    if page is None:
        page = {"duration": 0, "tracks": [], "description": "",
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None}
        try:
            oe = await _oembed(url)
            page.update(title=oe.get("title"), author=oe.get("author_name"))
        except Exception as e:  # noqa: BLE001
            log.warning("oEmbed also failed: %s", e)
    meta = {"title": page.get("title") or "Untitled", "author": page.get("author"),
            "platform": "youtube", "duration": page.get("duration") or 0,
            "description": page.get("description") or ""}
    return meta, page.get("tracks") or [], page.get("thumbnail")


async def acquire(url: str) -> ContentBundle:
    meta, tracks, thumb = await _metadata(url)
    images = [thumb] if thumb else []
    if meta["duration"] > settings.YOUTUBE_MAX_DIRECT_SECONDS:
        return await fallback(url, metadata=meta, tracks=tracks, images=images)
    # Tracks ride along (not persisted) so fallback() needn't refetch the watch page.
    return ContentBundle(kind="video_uri", video_uri=url, images=images,
                         metadata={**meta, "caption_tracks": tracks}, strategy="youtube_direct")


async def fallback(url: str, bundle: ContentBundle | None = None, *, metadata: dict | None = None,
                   tracks: list[dict] | None = None, images: list[str] | None = None
                   ) -> ContentBundle:
    """The scraper used when the model can't read the video. Never raises; with nothing at all
    to build a note from it returns a `metadata_only` bundle (→ salvage bookmark)."""
    from services import apify
    from services.sources.social_video import download_video, to_seconds, too_long

    if bundle is not None:
        metadata = dict(bundle.metadata)
        tracks = metadata.pop("caption_tracks", None) or []
        images = bundle.images
    elif metadata is None:
        metadata, tracks, thumb = await _metadata(url)
        images = [thumb] if thumb else []
    images = images or []
    meta = {**metadata}

    def text_bundle(text: str, via: str, thin: bool = False) -> ContentBundle:
        return ContentBundle(kind="text", text=text, images=images,
                             metadata={**meta, "via": via, **({"thin": True} if thin else {})},
                             strategy="youtube_fallback")

    transcript = await _fetch_transcript(tracks) if tracks else None
    if transcript and len(transcript) >= MIN_TRANSCRIPT_CHARS:
        return text_bundle(transcript, "captions")

    result = await apify.fetch_capped(url) or {}
    duration = to_seconds(meta.get("duration")) or to_seconds(result.get("duration"))
    # The mp4 path obeys the same file limit as reels: no multi-hour downloads.
    if (result.get("video_url") and not too_long(duration)
            and (video := await (download_video(result["video_url"], duration) if duration
                                 else download_video(result["video_url"])))):
        return ContentBundle(kind="text", text=meta.get("description") or None, images=images,
                             metadata={**meta, "via": "apify", "video_bytes": video[0],
                                       "video_mime": video[1],
                                       "caption": meta.get("description") or ""},
                             strategy="youtube_fallback_video")
    if subs := result.get("subtitles"):
        return text_bundle(subs, "apify")
    title = meta.get("title") if meta.get("title") not in (None, "", "Untitled") else None
    if not (meta.get("description") or title):
        # Never extract from the bare URL (the model would invent the video): a metadata-only
        # bundle makes process.py salvage an honest bookmark instead.
        return ContentBundle(kind="metadata_only", text=None, images=images,
                             metadata={**meta, "via": "none"}, strategy="youtube_fallback")
    if duration > settings.YOUTUBE_MAX_DIRECT_SECONDS:  # so the note can say why it's thin
        meta.update(too_long=True, duration=duration,
                    max_seconds=settings.YOUTUBE_MAX_DIRECT_SECONDS, built_from="description")
    return text_bundle(meta.get("description") or title, "description", thin=True)
