"""Apify scrapers — paid fallback when yt-dlp is IP-blocked from Cloud Run.

yt-dlp downloads fail cookie-less from datacenter IPs (Instagram's "login required /
rate-limit reached" wall); Apify owns the residential proxies + accounts and returns the
post's media URL + caption for a per-scrape fee. We then fetch that (publicly playable,
short-lived) CDN video URL and hand it to the normal GCS → Gemini video path.

Per-platform actors (env-overridable in config). Their input shapes differ — Instagram's
post scraper takes the URL in a `username` array, TikTok takes `postURLs`, Facebook takes
`startUrls` objects — so each platform carries its own input builder here. Output is
normalized with broad field-name candidates because actors disagree on key names. Dormant
unless APIFY_TOKEN is set. Fixed host (api.apify.com) so no SSRF gate is needed on the API
call; the returned media URL IS fetched through the net guard by the caller.
"""
import asyncio
import logging
from dataclasses import dataclass
from typing import Callable

import httpx

from config import settings

log = logging.getLogger("clipnote.apify")

_RUN_SYNC = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"

# Per-item field names vary by actor/post type; read the first present of each.
# `downloadedVideo` (Apify-hosted copy) is preferred over `videoUrl` (the IG/TikTok CDN URL):
# it's on api.apify.com — always fetchable, never referer-gated or time-signed. TikTok
# (clockworks) uses `mediaUrls` (array) / nested `videoMeta`; Instagram uses the flat fields.
_VIDEO_FIELDS = ("downloadedVideo", "videoUrl", "mediaUrls", "webVideoUrl", "downloadUrl")
_CAPTION_FIELDS = ("caption", "text", "title", "description")
_THUMB_FIELDS = ("displayUrl", "coverUrl", "thumbnailUrl", "imageUrl")
_AUTHOR_FIELDS = ("ownerFullName", "ownerUsername", "authorMeta", "author", "channelName")
_DURATION_FIELDS = ("videoDuration", "duration")
MAX_COMMENTS = 10


def _comments(item: dict) -> list[str]:
    """Top comments (creators often pin the full recipe there). Defensive: `latestComments`
    may be missing, null, strings, or dicts with text/ownerUsername."""
    raw = item.get("latestComments")
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for c in raw:
        text = c if isinstance(c, str) else (c.get("text") if isinstance(c, dict) else None)
        if isinstance(text, str) and text.strip():
            out.append(text.strip()[:500])
        if len(out) >= MAX_COMMENTS:
            break
    return out


def _subtitles_text(item: dict) -> str:
    """Plain text of a YouTube item's `subtitles` (list of {language, srt/plaintext/text} or
    str). Defensive: actor output shape is only loosely documented."""
    subs = item.get("subtitles")
    if isinstance(subs, str):
        return subs.strip()
    if not isinstance(subs, list):
        return ""
    parts = []
    for s in subs:
        if isinstance(s, str):
            parts.append(s)
        elif isinstance(s, dict):
            parts.append(next((s[k] for k in ("plaintext", "text", "srt", "vtt")
                               if isinstance(s.get(k), str) and s[k]), ""))
        if parts and parts[-1]:
            break  # one language track is enough
    text = " ".join(ln.strip() for ln in "\n".join(parts).splitlines()
                    if ln.strip() and "-->" not in ln and not ln.strip().isdigit())
    return text[:28000]
# Carousel/sidecar posts: the instagram-post-scraper returns every slide either as a flat
# `images` URL array or as `childPosts` objects each carrying their own `displayUrl`.
_IMAGES_FIELDS = ("images", "imageUrls")
# Cap how many slides we pull — keeps the Gemini request small and the (free) image
# fetches bounded for a pathological 20-slide carousel. 12 covers an intro slide + a
# 10-venue listicle (10 dropped the last venue).
MAX_CAROUSEL_IMAGES = 12


def _carousel_images(item: dict) -> list[str]:
    """All slide image URLs for a carousel/sidecar post, in order, deduped. Falls back to
    the single displayUrl for a normal image post."""
    urls: list[str] = []
    for k in _IMAGES_FIELDS:
        v = item.get(k)
        if isinstance(v, list):
            urls += [u for u in v if isinstance(u, str) and u]
    children = item.get("childPosts")
    if isinstance(children, list):
        for c in children:
            if isinstance(c, dict):
                u = c.get("displayUrl") or c.get("imageUrl")
                if isinstance(u, str) and u:
                    urls.append(u)
    if not urls:
        single = _first(item, _THUMB_FIELDS)
        if single:
            urls.append(single)
    # Order-preserving dedup, then cap.
    seen: set[str] = set()
    out = [u for u in urls if not (u in seen or seen.add(u))]
    return out[:MAX_CAROUSEL_IMAGES]


@dataclass(frozen=True)
class _Actor:
    actor_id: str                       # "apify~instagram-post-scraper"
    build_input: Callable[[str], dict]  # url → that actor's run input


# Input builders, one per actor, matching each actor's documented shape. Kept tiny and
# explicit so a shape change is a one-line edit. resultsLimit/resultsPerPage are pinned to
# 1 — we always scrape exactly the pasted URL.
def _ig_post_input(url: str) -> dict:
    # instagram-post-scraper accepts a post URL inside the `username` array. dataDetailLevel
    # must be "basicData" or "detailedData" (verified live — "fullData" is a 400).
    return {"username": [url], "resultsLimit": 1, "dataDetailLevel": "detailedData"}


def _ig_reel_input(url: str) -> dict:
    return {"username": [url], "resultsLimit": 1}


def _tiktok_input(url: str) -> dict:
    # shouldDownloadVideos populates `mediaUrls` with a fetchable URL for the video.
    return {"postURLs": [url], "resultsPerPage": 1, "shouldDownloadVideos": True,
            "shouldDownloadCovers": False}


def _facebook_input(url: str) -> dict:
    # `startUrls` is the shape used by the FB video/reel detail actors. Off by default
    # (APIFY_FACEBOOK_ACTOR empty) — the official facebook-reels actor is page-based, and
    # single-URL FB actors are community-maintained, so enabling it is a deliberate choice.
    return {"startUrls": [{"url": url}], "resultsLimit": 1}


def _youtube_input(url: str) -> dict:
    # streamers~youtube-scraper takes startUrls. Fallback only — Gemini handles YouTube
    # directly; this runs from process.py's extraction-failure path, not the resolver.
    # Verified live: this actor returns metadata + `subtitles` + `text` (description) but NO
    # downloadable video URL — so the YT fallback is transcript/text, not video. When the
    # trigger is built it needs YT-specific normalization (real `title` field, parse subtitles).
    # ponytail: subtitle keys are unverified — confirm with scripts/verify_apify.py on first
    # live run; without them `subtitles` never arrives while the paid slot is still consumed.
    return {"startUrls": [{"url": url}], "maxResults": 1, "downloadSubtitles": True,
            "subtitlesLanguage": "en", "subtitlesFormat": "plaintext"}


def _registry() -> dict[str, _Actor]:
    """Built per-call so env overrides (set after import) are honoured. An entry exists only
    when its actor id is configured — an unset actor (Facebook by default) is absent, so its
    URLs route to None and take the free og-caption path instead of a wasted paid run."""
    candidates = {
        "instagram_reel": (settings.APIFY_INSTAGRAM_REEL_ACTOR, _ig_reel_input),
        "instagram_post": (settings.APIFY_INSTAGRAM_POST_ACTOR, _ig_post_input),
        "tiktok": (settings.APIFY_TIKTOK_ACTOR, _tiktok_input),
        "facebook": (settings.APIFY_FACEBOOK_ACTOR, _facebook_input),
        "youtube": (settings.APIFY_YOUTUBE_ACTOR, _youtube_input),
    }
    return {k: _Actor(aid, fn) for k, (aid, fn) in candidates.items() if aid}


def _url_kind(url: str) -> str | None:
    u = url.lower()
    if "instagram.com" in u:
        return "instagram_reel" if "/reel" in u else "instagram_post"
    if "tiktok.com" in u:
        return "tiktok"
    if "facebook.com" in u or "fb.watch" in u:
        return "facebook"
    if "youtube.com" in u or "youtu.be" in u:
        return "youtube"
    return None


def actor_kind(url: str) -> str | None:
    """Registry key for this URL, or None if no *configured* actor covers it — in which case
    the caller takes the free og-caption fallback (no paid slot reserved)."""
    kind = _url_kind(url)
    return kind if kind in _registry() else None


def _first(item: dict, keys: tuple[str, ...]) -> str | None:
    """First usable value across candidate keys. Handles scalars, arrays (first string
    element — e.g. TikTok `mediaUrls`), and the nested author object (TikTok `authorMeta`)."""
    for k in keys:
        v = item.get(k)
        if isinstance(v, (str, int, float)) and str(v):
            return str(v)
        if isinstance(v, list):
            for el in v:
                if isinstance(el, str) and el:
                    return el
        if isinstance(v, dict):  # e.g. authorMeta.{name,nickName,...}
            for nested in ("name", "nickName", "fullName", "username"):
                if v.get(nested):
                    return str(v[nested])
    return None


def _normalize(item: dict) -> dict:
    caption = _first(item, _CAPTION_FIELDS) or ""
    dur = _first(item, _DURATION_FIELDS)
    video = _first(item, _VIDEO_FIELDS)
    thumb = _first(item, _THUMB_FIELDS)
    # TikTok (clockworks) nests its media under `videoMeta` with field-specific sub-keys —
    # handled explicitly here (not in _first, which would confuse them with author names).
    vm = item.get("videoMeta")
    if isinstance(vm, dict):
        video = video or vm.get("downloadAddr") or vm.get("playAddr")
        thumb = thumb or vm.get("coverUrl") or vm.get("originalCoverUrl")
        dur = dur or vm.get("duration")
    images = _carousel_images(item)
    return {
        "video_url": video,
        "caption": caption,
        # No dedicated title field — lead with the caption's first line, else the author.
        "title": (caption.splitlines()[0][:120] if caption else None)
                 or _first(item, _AUTHOR_FIELDS),
        "thumbnail": thumb or (images[0] if images else None),
        "images": images,        # every carousel slide (≥1 for image posts), [] for video
        "comments": _comments(item),
        "subtitles": _subtitles_text(item),
        "author": _first(item, _AUTHOR_FIELDS),
        "duration": int(float(dur)) if dur and str(dur).replace(".", "").isdigit() else 0,
    }


def _run(actor: _Actor, url: str) -> dict | None:
    endpoint = _RUN_SYNC.format(actor=actor.actor_id)
    # Apify cold-starts the actor; allow generous time. The sync endpoint returns the
    # dataset items directly, so no polling loop is needed.
    with httpx.Client(timeout=75.0) as client:
        resp = client.post(endpoint, headers={"Authorization": f"Bearer {settings.APIFY_TOKEN}"},
                           json=actor.build_input(url))
    resp.raise_for_status()
    items = resp.json()
    if not isinstance(items, list) or not items:
        return None
    return _normalize(items[0])


async def fetch(url: str) -> dict | None:
    """Returns {video_url, caption, title, thumbnail, author, duration} or None.

    None means 'nothing usable' (no token, no actor for this URL, empty result, or error) —
    the caller then falls through to the free og-caption path. Never raises."""
    if not settings.APIFY_TOKEN:
        return None
    kind = actor_kind(url)
    if kind is None:
        return None
    actor = _registry()[kind]
    try:
        result = await asyncio.to_thread(_run, actor, url)
        if result:
            log.info("apify %s scraped %s (video=%s)", actor.actor_id, url,
                     bool(result.get("video_url")))
        return result
    except Exception as e:  # noqa: BLE001 — paid fallback is best-effort.
        log.warning("apify %s failed for %s: %s: %s", actor.actor_id, url,
                    type(e).__name__, str(e)[:200])
        return None
