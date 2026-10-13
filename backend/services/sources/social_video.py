"""Instagram reels/posts, Facebook video, TikTok: get the VIDEO FILE, the model watches it.

Video-file ladder (free first, paid Apify only when that fails):
  Instagram  → Apify (`videoUrl`, caption, top comments, carousel slides). No free rung: the
               public embed page never carries the video (A/B: 11/11 fell through).
  TikTok/FB  → yt-dlp download → Apify (no paid video download; we fetch its CDN URL).
Limits: a video longer than MAX_VIDEO_SECONDS (duration read from yt-dlp/Apify metadata BEFORE
any download) is never fetched → thin caption bundle with `metadata["too_long"]` + `duration`.
Otherwise ONE ≤360p mp4; a file over VIDEO_MAX_BYTES (but ≤60 MB raw) is re-encoded with ffmpeg
to fit, else dropped to caption-only. Held in memory as `metadata["video_bytes"]` /
`metadata["video_mime"]` (never cached, never written anywhere). routers/process.py hands it to
`gemini_service.extract_from_video`.

No video obtainable → a caption-only bundle marked `metadata["thin"]` (a save never fails for a
missing video). Carousels/image posts → ≤6 slides at 768 px for the vision model. Nothing at all
(login wall) → `private_or_blocked`.

Scrape metadata (caption, comments, media URL, thumbnail, slides) is cached 6 h per canonical
URL (services/acq_cache.py) so retries and the sweep don't re-run Apify; a cached media URL that
no longer downloads (IG CDN links expire) re-runs the ladder from the top.
"""
import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from urllib.parse import urlparse

import yt_dlp
import httpx
from bs4 import BeautifulSoup

from config import settings
from models.note import ContentBundle
from services import acq_cache
from services.net_guard import BlockedURLError, assert_public_url, guarded_async_client
from services.url_utils import host_matches

log = logging.getLogger("keeps.sources")

# Instagram serves og: tags to link-preview crawlers; mimic one to get the caption reliably.
_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
_BROWSER_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
               "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")

_DOMAINS = ("instagram.com", "facebook.com", "fb.watch", "tiktok.com")

_IMAGE_MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
               "webp": "image/webp", "gif": "image/gif"}

# Listicle captions routinely run past 2k chars; still bounded so a pathological caption
# can't bloat the model request.
_CAPTION_MAX = 4000
MAX_SLIDES = 6
SLIDE_WIDTH = 768

# Wall-clock budgets (s).
DOWNLOAD_TIMEOUT_SECONDS = 45
FFMPEG_TIMEOUT_SECONDS = 15
# A caption + title shorter than this is "thin".
THIN_CHARS = 120

os.makedirs(settings.TEMP_DOWNLOAD_DIR, exist_ok=True)


def matches(url: str) -> bool:
    return host_matches(url, _DOMAINS)


def _platform(url: str) -> str:
    if host_matches(url, ("instagram.com",)):
        return "instagram"
    if host_matches(url, ("tiktok.com",)):
        return "tiktok"
    return "facebook"


# ---------- media fetches ----------

# A raw download may exceed VIDEO_MAX_BYTES by this much and still be re-encoded to fit.
RAW_DOWNLOAD_MAX_BYTES = 60_000_000
REENCODE_TIMEOUT_SECONDS = 60
AUDIO_KBPS = 48


def raw_cap() -> int:
    return max(settings.VIDEO_MAX_BYTES, RAW_DOWNLOAD_MAX_BYTES)


def to_seconds(v) -> int:
    """Duration from loosely typed metadata (int, float, "90.5", "PT1M30S"-free). 0 = unknown."""
    try:
        return int(float(v)) if v not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def too_long(duration: int) -> bool:
    return duration > settings.MAX_VIDEO_SECONDS


def _reencode(path: str, duration: int, *, failure: dict | None = None) -> bytes | None:
    """Shrink an oversized file to fit VIDEO_MAX_BYTES: one ffmpeg pass, ≤360p, bitrate from the
    duration, mono 48 kbps AAC. None when the duration is unknown or ffmpeg fails/still too big.
    # ponytail: single-pass ABR can overshoot a little; the 0.9 headroom + final size check cover it."""
    if duration <= 0:
        return None
    total_kbps = settings.VIDEO_MAX_BYTES * 8 * 0.9 / duration / 1000
    v_kbps = int(total_kbps - AUDIO_KBPS)
    if v_kbps < 50:  # not watchable at that bitrate
        return None
    out = path + ".small.mp4"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", path,
             "-vf", "scale=-2:'min(360,ih)'", "-c:v", "libx264", "-preset", "veryfast",
             "-b:v", f"{v_kbps}k", "-maxrate", f"{v_kbps}k", "-bufsize", f"{2 * v_kbps}k",
             "-c:a", "aac", "-ac", "1", "-b:a", f"{AUDIO_KBPS}k", "-movflags", "+faststart", out],
            check=True, timeout=REENCODE_TIMEOUT_SECONDS,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        size = os.path.getsize(out)
        if not 0 < size <= settings.VIDEO_MAX_BYTES:
            return None
        with open(out, "rb") as f:
            return f.read()
    except Exception as e:  # noqa: BLE001 — fall back to a thin caption note
        if failure is not None:
            failure["reason"] = "transient"
        log.info("re-encode failed: %s: %s", type(e).__name__, str(e)[:160])
        return None
    finally:
        if os.path.exists(out):
            os.remove(out)


def _fit(data: bytes, mime: str, duration: int, *, failure: dict | None = None) -> tuple[bytes, str] | None:
    """Pass a file that fits; re-encode an oversized one (temp file, always removed)."""
    if len(data) <= settings.VIDEO_MAX_BYTES:
        return data, mime
    if duration <= 0:
        log.info("video over VIDEO_MAX_BYTES with unknown duration; caption only")
        return None
    workdir = tempfile.mkdtemp(dir=settings.TEMP_DOWNLOAD_DIR)
    try:
        path = os.path.join(workdir, "in")
        with open(path, "wb") as f:
            f.write(data)
        small = _reencode(path, duration, failure=failure)
        return (small, "video/mp4") if small else None
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def download_video(media_url: str, duration: int = 0, *,
                         failure: dict | None = None) -> tuple[bytes, str] | None:
    """Fetch one video into memory (net-guarded, streamed, capped at raw_cap()), re-encoding it
    down to VIDEO_MAX_BYTES when it's bigger. Apify key-value-store URLs need the token as a
    header (never in the URL, which httpx logs). None on any failure (expired/403/404 CDN link,
    over the raw cap, timeout, re-encode failed). Without a known duration an oversized file
    can't be re-encoded, so the stream stops at VIDEO_MAX_BYTES instead of raw_cap()."""
    headers = {"User-Agent": _BROWSER_UA}
    if urlparse(media_url).hostname == "api.apify.com" and settings.APIFY_TOKEN:
        headers["Authorization"] = f"Bearer {settings.APIFY_TOKEN}"
    cap = raw_cap() if duration > 0 else settings.VIDEO_MAX_BYTES

    async def _go() -> tuple[bytes, str]:
        buf = bytearray()
        async with guarded_async_client(timeout=30.0, follow_redirects=True) as client:
            async with client.stream("GET", media_url, headers=headers) as resp:
                resp.raise_for_status()
                ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                if ct and not (ct.startswith("video/") or ct in (
                        "application/octet-stream", "binary/octet-stream")):
                    raise ValueError(f"not a video ({ct})")
                if int(resp.headers.get("content-length") or 0) > cap:
                    raise ValueError(f"video exceeds {cap} bytes")
                async for chunk in resp.aiter_bytes(65536):
                    buf += chunk
                    if len(buf) > cap:
                        raise ValueError(f"video exceeds {cap} bytes")
        if not buf:
            raise ValueError("empty video")
        return bytes(buf), ct if ct.startswith("video/") else "video/mp4"

    async def _with_retry() -> tuple[bytes, str]:
        for attempt in range(2):
            try:
                return await _go()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                transient = (isinstance(exc, httpx.TransportError)
                             or exc.response.status_code in (408, 429, 500, 502, 503, 504))
                if attempt or not transient:
                    raise
                await asyncio.sleep(0.5)

    try:
        # Both attempts share the original acquisition deadline and reuse the paid URL.
        data, mime = await asyncio.wait_for(_with_retry(), timeout=DOWNLOAD_TIMEOUT_SECONDS)
    except Exception as e:  # noqa: BLE001
        if isinstance(e, BlockedURLError):
            raise
        if failure is not None:
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (403, 404, 410):
                failure["reason"] = "expired"
            elif isinstance(e, (httpx.TransportError, TimeoutError)) or (
                    isinstance(e, httpx.HTTPStatusError)
                    and e.response.status_code in (408, 429, 500, 502, 503, 504)):
                failure["reason"] = "transient"
            else:
                failure["reason"] = "permanent"
        log.info("video download failed: %s: %s", type(e).__name__, str(e)[:160])
        return None
    if len(data) <= settings.VIDEO_MAX_BYTES:
        return data, mime
    fitted = await asyncio.to_thread(_fit, data, mime, duration, failure=failure)
    if fitted is None and failure is not None:
        failure.setdefault("reason", "permanent")
    return fitted


async def _download(media_url: str, duration: int) -> tuple[tuple[bytes, str] | None, str | None]:
    # Duration only when known — it's what makes an oversized file re-encodable.
    failure = {}
    video = await download_video(media_url, duration, failure=failure)
    return video, failure.get("reason", "transient" if video is None else None)


def _ydl_opts(workdir: str) -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "format": "best[height<=360][ext=mp4]/best[height<=360]/worst",
        "outtmpl": os.path.join(workdir, "%(id)s.%(ext)s"),
        "merge_output_format": "mp4",
        "max_filesize": raw_cap(),
        # asyncio.wait_for cannot kill the thread — socket_timeout is what actually frees it.
        "socket_timeout": 30,
        # Platform extractors only (fullmatch on the lowercased IE name). Never `generic`: it
        # follows arbitrary pages/embeds with yt-dlp's own HTTP, outside net_guard.
        "allowed_extractors": [r"(vm\.)?tiktok(:.*)?", r"facebook.*", r"instagram.*"],
    }


def _assert_public_media(info: dict) -> None:
    """yt-dlp fetches media itself, outside guarded_async_client: check every candidate media
    URL it resolved before it downloads. Raises BlockedURLError."""
    urls = set()
    for item in [info, *(e for e in info.get("entries") or [] if isinstance(e, dict))]:
        for f in [item, *(item.get("formats") or [])]:
            urls.update(f.get(k) for k in ("url", "manifest_url", "fragment_base_url"))
    for u in urls - {None}:
        assert_public_url(u)


def _ytdlp_download(url: str) -> tuple[dict, bytes | None, str]:
    """yt-dlp metadata, then — only when the duration is within MAX_VIDEO_SECONDS — one ≤360p
    file, re-encoded to fit VIDEO_MAX_BYTES if needed. The temp dir is always removed."""
    workdir = tempfile.mkdtemp(dir=settings.TEMP_DOWNLOAD_DIR)
    try:
        with yt_dlp.YoutubeDL(_ydl_opts(workdir)) as ydl:
            info = ydl.extract_info(url, download=False) or {}
            duration = to_seconds(info.get("duration"))
            if too_long(duration):
                return info, None, ""          # gate: never download an over-long video
            if not duration:  # can't re-encode without a duration: fetch only what fits as-is
                ydl.params["max_filesize"] = settings.VIDEO_MAX_BYTES
            _assert_public_media(info)
            ydl.process_ie_result(info, download=True)
        files = sorted(f for f in os.listdir(workdir) if not f.endswith(".part"))
        if not files:
            return info, None, ""
        path = os.path.join(workdir, files[0])
        ext = files[0].rsplit(".", 1)[-1].lower()
        mime = "video/webm" if ext == "webm" else "video/mp4"
        if os.path.getsize(path) > raw_cap():
            return info, None, ""
        if os.path.getsize(path) > settings.VIDEO_MAX_BYTES:
            small = _reencode(path, to_seconds(info.get("duration")))
            return (info, small, "video/mp4") if small else (info, None, "")
        with open(path, "rb") as f:
            return info, f.read(), mime
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


async def _downscale(data: bytes, width: int = SLIDE_WIDTH, q: int = 4) -> bytes | None:
    """≤`width` px wide JPEG (mjpeg `q`, 2 best–31 worst) via ffmpeg. None = keep the original."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-loglevel", "error", "-i", "pipe:0",
            "-vf", f"scale='min({width},iw)':-2", "-frames:v", "1",
            "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", str(q), "pipe:1",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(proc.communicate(data), timeout=FFMPEG_TIMEOUT_SECONDS)
        return out if proc.returncode == 0 and out else None
    except Exception as e:  # noqa: BLE001 — downscaling is an optimisation only
        log.info("image downscale failed: %s", str(e)[:120])
        return None


async def _fetch_image(u: str, cap: int) -> dict | None:
    try:
        async with guarded_async_client(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(u, headers={"User-Agent": _CRAWLER_UA})
        resp.raise_for_status()
        data = resp.content
        if not data or len(data) > cap:
            return None
        if small := await _downscale(data):
            return {"mime_type": "image/jpeg", "data": small}
        ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if not ct.startswith("image/"):
            ct = _IMAGE_MIME.get(u.split("?")[0].rsplit(".", 1)[-1].lower(), "image/jpeg")
        return {"mime_type": ct, "data": data}
    except Exception as e:  # noqa: BLE001 — a failed slide is skipped, not fatal
        log.info("image fetch failed (%s): %s", u[:80], str(e)[:120])
        return None


async def _fetch_image_parts(urls: list[str], *, cap_mb: int = 8) -> list[dict]:
    """≤6 slides fetched in parallel, downscaled to 768 px, input order kept. Returns
    [{"mime_type", "data"}]; failed slides are dropped."""
    urls = [u for u in urls if u][:MAX_SLIDES]
    parts = await asyncio.gather(*(_fetch_image(u, cap_mb * 1024 * 1024) for u in urls))
    return [p for p in parts if p]


# ---------- ladder rungs (each returns a metadata entry or None) ----------

async def _apify_entry(url: str) -> dict | None:
    """Paid scrape (only successful runs count against the daily cap)."""
    from services import apify

    result = await apify.fetch_capped(url)
    if not result:
        return None
    images = result.get("images") or ([result["thumbnail"]] if result.get("thumbnail") else [])
    is_video = bool(result.get("video_url")) and len(images) <= 1
    entry = {"caption": (result.get("caption") or "")[:_CAPTION_MAX],
             "comments": result.get("comments") or [],
             "media_url": result.get("video_url") if is_video else None,
             "thumbnail": result.get("thumbnail") or (images[0] if images else None),
             "images": [] if is_video else images[:MAX_SLIDES],
             "image_count": 0 if is_video else result.get("image_count", len(images)),
             "title": result.get("title"), "author": result.get("author"), "via": "apify",
             "duration": to_seconds(result.get("duration"))}
    if is_video:
        entry["strategy"] = "reel_video"
    elif images:
        entry["strategy"] = "apify_carousel" if len(images) > 1 else "apify_caption"
    else:
        entry["strategy"] = "reel_caption"
    if not (entry["caption"] or entry["comments"] or entry["media_url"] or entry["images"]):
        return None
    return entry


# ---------- bundle assembly ----------

def _text(entry: dict) -> str:
    text = "\n\n".join(p for p in (entry.get("title"), entry.get("caption")) if p).strip()
    if comments := entry.get("comments"):
        text += "\n\nTop comments (may contain the full recipe):\n" + "\n".join(
            f"- {c}" for c in comments)
    return text.strip()


def _metadata(url: str, entry: dict) -> dict:
    return {"title": entry.get("title") or _platform(url), "author": entry.get("author"),
            "platform": _platform(url), "caption": entry.get("caption") or "",
            "comments": entry.get("comments") or [], "via": entry.get("via"),
            "media_url": entry.get("media_url"), "duration": entry.get("duration") or 0,
            **({"too_long": True} if entry.get("too_long") else {})}


async def _bundle(url: str, entry: dict, video: tuple[bytes, str] | None) -> ContentBundle:
    meta = _metadata(url, entry)
    cover = [entry["thumbnail"]] if entry.get("thumbnail") else []
    if entry.get("images"):
        parts = await _fetch_image_parts(entry["images"])
        meta["slides"] = len(parts)
        meta["slides_expected"] = len(entry["images"][:MAX_SLIDES])
        meta["slides_available"] = entry.get("image_count", len(entry["images"]))
        if len(parts) < meta["slides_available"]:
            meta["thin"] = True
        return ContentBundle(kind="text", text=_text(entry) or None, images=entry["images"][:1],
                             image_parts=parts, metadata=meta, strategy=entry["strategy"])
    if video:
        meta.update(video_bytes=video[0], video_mime=video[1])
        return ContentBundle(kind="text", text=_text(entry) or None, images=cover,
                             metadata=meta, strategy="reel_video")
    meta["thin"] = True
    return ContentBundle(kind="text", text=_text(entry) or None, images=cover,
                         metadata=meta, strategy="reel_caption")


async def _ladder(url: str) -> tuple[dict | None, tuple[bytes, str] | None]:
    """Free rung, then Apify. Returns (entry, video) — entry None when nothing worked."""
    leftover = None  # yt-dlp's caption-only result, used if Apify also fails
    # Instagram: straight to Apify, with og tags as the no-Apify fallback.
    if _platform(url) != "instagram":
        try:
            info, data, mime = await asyncio.wait_for(asyncio.to_thread(_ytdlp_download, url),
                                                      timeout=DOWNLOAD_TIMEOUT_SECONDS)
            e = {"caption": (info.get("description") or "")[:_CAPTION_MAX],
                 "title": info.get("title") or info.get("fulltitle"),
                 "author": info.get("uploader") or info.get("creator") or info.get("channel"),
                 "thumbnail": info.get("thumbnail"), "strategy": "reel_video", "via": "ytdlp",
                 "duration": to_seconds(info.get("duration"))}
            if data:
                return e, (data, mime)
            if too_long(e["duration"]):
                e = {**e, "too_long": True, "strategy": "reel_caption", "media_url": None}
                if e["caption"]:
                    return e, None  # known too long: don't pay Apify for a video we won't fetch
            leftover = e if e["caption"] else None
        except BlockedURLError:
            raise  # permanent: never fall through to Apify for an internal target
        except Exception as ex:  # noqa: BLE001
            log.info("yt-dlp failed for %s (%s): %s", _platform(url), url, str(ex)[:160])

    if entry := await _apify_entry(url):
        video = None
        if entry.get("media_url") and too_long(entry["duration"]):
            # The paid run already happened (it counts); just don't download hours of video.
            entry = {**entry, "too_long": True, "strategy": "reel_caption", "media_url": None}
        if entry.get("media_url"):
            video, reason = await _download(entry["media_url"], entry["duration"])
            if reason:
                entry["download_failure"] = reason
            # Keep scraped media metadata even when this download fails. Timeouts and
            # CDN throttling are recoverable; the current bundle can still be thin.
        return entry, video
    if leftover and leftover.get("caption"):
        return {**leftover, "strategy": "reel_caption", "media_url": None}, None
    return None, None


async def acquire(url: str) -> ContentBundle:
    """Never raises for a blocked source — the last rung returns `private_or_blocked`."""
    cached = await acq_cache.get(url)
    if cached:
        if cached.get("strategy") != "reel_video":
            bundle = await _bundle(url, cached, None)
            if not cached.get("images") or bundle.image_parts:
                return bundle
            # All cached slide URLs failed: refresh once through the capped ladder.
            entry, video = await _ladder(url)
            if entry is not None:
                await acq_cache.put(url, entry)
                return await _bundle(url, entry, video)
            return bundle
        if cached.get("download_failure") == "permanent":
            return await _bundle(url, cached, None)
        if cached.get("media_url"):
            video, reason = await _download(cached["media_url"], to_seconds(cached.get("duration")))
            if video:
                return await _bundle(url, cached, video)
            if reason != "expired":
                await acq_cache.put(url, {**cached, "download_failure": reason})
                return await _bundle(url, cached, None)
        log.info("cached media url unusable; re-running the ladder", extra={"url": url})

    entry, video = await _ladder(url)
    if entry is None:
        if cached:
            return await _bundle(url, cached, None)
        return await _caption_fallback(url)
    # Cache only what a real acquisition produced (a media URL or a paid scrape). A caption-only
    # result after an Apify cap/failure must not freeze a re-extract thin for 6 h.
    if entry.get("media_url") or entry.get("via") == "apify":
        await acq_cache.put(url, entry)
    return await _bundle(url, entry, video)


# ---------- last free rung: og tags ----------

# The generic title Instagram/Facebook/TikTok serve to link-preview crawlers on a login wall.
_BLOCKED_OG_TITLES = {"instagram", "login • instagram", "instagram • login", "facebook",
                      "log in to facebook", "tiktok", "tiktok - make your day"}
# Login-wall copy served as og:description to link-preview crawlers (substring, lowercased).
_BLOCKED_OG_DESCRIPTIONS = ("log in to facebook", "log in to instagram",
                            "see photos and videos from friends",
                            "create an account or log in")


def _blocked_bundle(url: str, platform: str) -> ContentBundle:
    return ContentBundle(kind="metadata_only", text=None,
                         metadata={"title": platform, "platform": platform},
                         strategy="private_or_blocked")


async def _caption_fallback(url: str) -> ContentBundle:
    """Build a thin note from the post's public og: tags when every richer rung failed. If they
    yield no real caption (a login wall serves only the generic site title) the result is
    `private_or_blocked` — NEVER `text=url`, which would let the model hallucinate a note."""
    platform = _platform(url)
    title = caption = image = None
    try:
        async with guarded_async_client(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": _CRAWLER_UA,
                                                  "Accept-Language": "en-US,en;q=0.9"})
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text[:300_000], "html.parser")
        if t := soup.find("meta", property="og:title"):
            title = t.get("content")
        if d := soup.find("meta", property="og:description"):
            caption = d.get("content")
        if im := soup.find("meta", property="og:image"):
            image = im.get("content")
    except Exception as e:  # noqa: BLE001
        log.info("caption fallback fetch failed for %s: %s", url, str(e)[:160])
    if title and title.strip().lower() in _BLOCKED_OG_TITLES:
        title = caption = image = None  # login wall: its description/logo are wall copy too
    if caption and any(p in caption.lower() for p in _BLOCKED_OG_DESCRIPTIONS):
        caption = image = None
    if not caption:  # a title or generic logo alone is not content
        return _blocked_bundle(url, platform)
    text = "\n\n".join(p for p in (title, caption) if p).strip()
    # The one og:image goes to the vision model too: for an image post that IS the content.
    image_parts = await _fetch_image_parts([image]) if image else []
    return ContentBundle(
        kind="text", text=text or None, images=[image] if image else [],
        image_parts=image_parts,
        metadata={"title": title or platform, "platform": platform, "caption": caption,
                  "via": "og", "thin": True},
        strategy="social_og",
    )
