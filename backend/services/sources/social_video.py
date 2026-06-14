"""Instagram reels/posts, Facebook video, TikTok: download via yt-dlp → GCS → gs:// URI.

These platforms cannot be analyzed by Gemini directly (unlike YouTube), so the video is
downloaded at ≤480p, uploaded to Cloud Storage, and handed to Gemini by gs:// URI —
never inline bytes (the ~20 MB inline cap fails most videos).

Acquisition ladder (cookies deliberately NOT used — Instagram/Facebook block cookie-less
yt-dlp from datacenter IPs with a "rate-limit reached or login required" wall):
  1. yt-dlp download → GCS → gs:// URI (works locally and for reels that slip past the wall)
  2. Apify per-platform scraper (`services/apify.py`, gated on APIFY_TOKEN) — residential
     proxies + accounts; fetch its returned mp4 → GCS → gs:// URI
  3. `_caption_fallback` — the post's public og: tags (og:description IS the caption, what
     powers link previews), so the resolver never drops through to the generic scraper,
     which only ever sees the logged-out login page.
"""
import asyncio
import glob
import logging
import os
import uuid

import yt_dlp
from bs4 import BeautifulSoup

from config import settings
from models.note import ContentBundle
from services.net_guard import guarded_async_client

log = logging.getLogger("clipnote.sources")

# Instagram serves og: tags to link-preview crawlers; mimic one to get the caption reliably.
_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"

_DOMAINS = ("instagram.com", "facebook.com", "fb.watch", "tiktok.com")

os.makedirs(settings.TEMP_DOWNLOAD_DIR, exist_ok=True)


def matches(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in _DOMAINS)


def _platform(url: str) -> str:
    u = url.lower()
    if "instagram" in u:
        return "instagram"
    if "tiktok" in u:
        return "tiktok"
    return "facebook"


def _ydl_opts(download: bool) -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo[height<=480]+bestaudio/best[height<=480]/worst",
        "outtmpl": os.path.join(settings.TEMP_DOWNLOAD_DIR, "%(id)s.%(ext)s"),
        "merge_output_format": "mp4",
        "overwrites": True,
        "skip_download": not download,
        "max_filesize": settings.MAX_MEDIA_DOWNLOAD_MB * 1024 * 1024,
    }
    return opts


def _download(url: str) -> tuple[str | None, dict]:
    with yt_dlp.YoutubeDL(_ydl_opts(download=True)) as ydl:
        info = ydl.extract_info(url, download=True)
        if not info:
            return None, {}
        filename = ydl.prepare_filename(info)
        base = os.path.splitext(filename)[0]
        # Prefer a known container; else fall back to whatever was actually written for this
        # id (glob) so an exotic extension is still used — and, crucially, still cleaned up
        # by acquire()'s finally rather than orphaned in /tmp until the container restarts.
        file_path = next(
            (p for ext in ("mp4", "mkv", "webm", "m4a")
             if os.path.exists(p := f"{base}.{ext}")),
            None,
        )
        if not file_path:
            stray = glob.glob(f"{glob.escape(base)}.*")
            file_path = (filename if os.path.exists(filename) else
                         stray[0] if stray else None)
        return file_path, info


def _upload_to_gcs(file_path: str) -> str:
    from google.cloud import storage
    client = storage.Client(project=settings.GOOGLE_CLOUD_PROJECT)
    bucket = client.bucket(settings.CLOUD_STORAGE_BUCKET)
    blob_name = f"media/{uuid.uuid4()}{os.path.splitext(file_path)[1]}"
    bucket.blob(blob_name).upload_from_filename(file_path)
    return f"gs://{settings.CLOUD_STORAGE_BUCKET}/{blob_name}"


def _metadata(info: dict, url: str) -> dict:
    return {
        "title": info.get("title") or info.get("fulltitle") or "Untitled",
        "author": info.get("uploader") or info.get("creator") or info.get("channel"),
        "platform": _platform(url),
        "duration": int(info.get("duration") or 0),
        "caption": (info.get("description") or "")[:2000],
    }


async def _caption_fallback(url: str) -> ContentBundle:
    """Build a note from the post's public og: tags when the media download is blocked.

    Instagram/Facebook/TikTok serve og:title, og:description (the caption), and og:image to
    logged-out link-preview crawlers for public posts — far richer than the login-wall HTML
    the generic scraper would otherwise see. Best-effort: a fetch failure yields a URL-only
    bundle and the pipeline salvages a bookmark from there.
    """
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
    except Exception as e:
        log.info("caption fallback fetch failed for %s: %s", url, str(e)[:160])

    text = "\n\n".join(p for p in (title, caption) if p).strip()
    return ContentBundle(
        kind="text",
        text=text or url,
        images=[image] if image else [],
        metadata={"title": title or platform, "platform": platform, "caption": caption or ""},
        strategy="social_og",
    )


async def _video_bundle_from_file(file_path: str, meta: dict, *, thumbnail: str | None,
                                  strategy: str) -> ContentBundle:
    """Frame-extract a durable cover, upload the video to GCS, and build the video_uri
    bundle. Shared by the yt-dlp and Apify paths. With no bucket configured, degrade to a
    caption/metadata text bundle (there's no gs:// URI to hand Gemini)."""
    images: list[str] = []
    # Durable cover from local bytes — the platform CDN thumbnail is referer-gated,
    # datacenter-IP blocked, and time-signed (expires in days). A frame from the file we
    # already have is reliable and permanent.
    from services.covers import extract_video_frame
    frame_url = await extract_video_frame(file_path)
    if frame_url:
        images = [frame_url]
    if not images and thumbnail:
        images = [thumbnail]

    if settings.CLOUD_STORAGE_BUCKET:
        gcs_uri = await asyncio.to_thread(_upload_to_gcs, file_path)
        return ContentBundle(kind="video_uri", video_uri=gcs_uri,
                             text=meta.get("caption") or None, images=images,
                             metadata=meta, strategy=strategy)
    return ContentBundle(kind="text", text=meta.get("caption") or meta.get("title"),
                         images=images, metadata=meta, strategy="social_caption")


async def _download_media(media_url: str) -> str | None:
    """Stream a media URL (a CDN URL or an Apify-hosted `downloadedVideo`) to a temp file —
    size-capped and net-guarded like every other outbound fetch. Apify key-value-store URLs
    need the API token appended. Returns the path, or None on any failure."""
    if "api.apify.com" in media_url and settings.APIFY_TOKEN and "token=" not in media_url:
        sep = "&" if "?" in media_url else "?"
        media_url = f"{media_url}{sep}token={settings.APIFY_TOKEN}"
    dest = os.path.join(settings.TEMP_DOWNLOAD_DIR, f"{uuid.uuid4()}.mp4")
    cap = settings.MAX_MEDIA_DOWNLOAD_MB * 1024 * 1024
    written = 0
    try:
        async with guarded_async_client(timeout=60.0, follow_redirects=True) as client:
            async with client.stream("GET", media_url,
                                     headers={"User-Agent": _CRAWLER_UA}) as resp:
                resp.raise_for_status()
                with open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes(65536):
                        written += len(chunk)
                        if written > cap:
                            raise ValueError(f"media exceeds {settings.MAX_MEDIA_DOWNLOAD_MB} MB cap")
                        f.write(chunk)
        return dest
    except Exception as e:
        log.warning("apify media download failed: %s: %s", type(e).__name__, str(e)[:160])
        if os.path.exists(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
        return None


async def _acquire_via_apify(url: str) -> ContentBundle | None:
    """Paid third-party scrape: a per-platform Apify actor (residential proxies + accounts)
    returns the media URL + caption; we fetch the video and route it through the normal
    GCS → Gemini path. Returns None to fall through to the free og-caption path — no token,
    no actor for this URL, daily cap hit, empty result, or any error."""
    from services import apify
    from services.firebase import reserve_apify_slot

    # Cheap pre-checks before reserving a (paid) slot: token set and an actor exists.
    if not settings.APIFY_TOKEN or apify.actor_kind(url) is None:
        return None

    if not await reserve_apify_slot():
        log.info("apify daily cap reached; og-caption fallback for %s", url)
        return None

    result = await apify.fetch(url)
    if not result:
        return None

    meta = {
        "title": result.get("title") or _platform(url),
        "author": result.get("author"),
        "platform": _platform(url),
        "duration": result.get("duration") or 0,
        "caption": (result.get("caption") or "")[:2000],
    }

    video_url = result.get("video_url")
    if video_url and settings.CLOUD_STORAGE_BUCKET:
        tmp = await _download_media(video_url)
        if tmp:
            try:
                return await _video_bundle_from_file(
                    tmp, meta, thumbnail=result.get("thumbnail"), strategy="apify_gcs")
            finally:
                if os.path.exists(tmp):
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass

    # Image post, no bucket, or the video fetch failed — caption + thumbnail from Apify.
    text = "\n\n".join(p for p in (result.get("title"), meta["caption"]) if p).strip()
    if not text:
        return None  # nothing usable; let og-caption try
    return ContentBundle(
        kind="text", text=text,
        images=[result["thumbnail"]] if result.get("thumbnail") else [],
        metadata=meta, strategy="apify_caption",
    )


async def acquire(url: str) -> ContentBundle:
    file_path = None
    try:
        try:
            file_path, info = await asyncio.to_thread(_download, url)
        except Exception as e:
            # Download blocked (Instagram's "login required / rate-limit reached" wall is
            # routine from datacenter IPs without cookies). Don't let it raise to the
            # resolver — its generic fallback only sees the login page. Walk the ladder:
            # paid Apify scrape (if configured) → free og-caption.
            log.info("yt-dlp download failed for %s (%s); trying fallback ladder: %s",
                     _platform(url), url, str(e)[:160])
            file_path, info = None, None

        if not file_path or not info:
            apify_bundle = await _acquire_via_apify(url)
            return apify_bundle if apify_bundle is not None else await _caption_fallback(url)

        meta = _metadata(info, url)
        return await _video_bundle_from_file(
            file_path, meta, thumbnail=info.get("thumbnail"), strategy="ytdlp_gcs")
    finally:
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
