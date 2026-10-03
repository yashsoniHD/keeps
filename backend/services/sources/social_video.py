"""Instagram reels/posts, Facebook video, TikTok: a cheap-first cascade, never whole video.

Tiers (escalate only when the extracted note is incomplete — see routers/process.py):
  1. caption + comments: yt-dlp metadata (no download); if the caption is thin, one Apify call
     (caption, latestComments, media url). Free / ~$0.003. Strategy `reel_caption`.
  2. audio transcript: ONE ≤360p download -> ffmpeg mp3 -> Whisper via OpenRouter.
     Strategy `reel_transcript`.
  3. ≤8 frames from the same file -> vision model. Strategy `reel_frames`.
  Nothing usable (login wall, empty og) -> `private_or_blocked`.
Instagram non-reel posts (/p/, carousels) are Apify-first: caption + every slide as vision.
Cookies are deliberately NOT used — Instagram/Facebook block cookie-less yt-dlp from
datacenter IPs, so `_caption_fallback` (og tags, tokenless oEmbed) is the last free rung.
"""
import asyncio
import glob
import logging
import os
import shutil
import tempfile
import uuid
from urllib.parse import quote

import yt_dlp
from bs4 import BeautifulSoup

from config import settings
from models.note import ContentBundle
from services.net_guard import guarded_async_client

log = logging.getLogger("clipnote.sources")

# Instagram serves og: tags to link-preview crawlers; mimic one to get the caption reliably.
_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"

_DOMAINS = ("instagram.com", "facebook.com", "fb.watch", "tiktok.com")

_IMAGE_MIME = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
               "webp": "image/webp", "gif": "image/gif"}

# How much of a post's caption to keep. Listicle captions ("10 restaurants…", full recipe in
# the description) routinely run past 2k chars — truncating them was the root cause of venues
# 4–10 coming back bare. Still bounded so a pathological caption can't bloat the Gemini request.
_CAPTION_MAX = 4000

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


def _ydl_opts(download: bool, workdir: str | None = None) -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "format": "best[height<=360]/bestvideo[height<=360]+bestaudio/worst",
        "outtmpl": os.path.join(workdir or settings.TEMP_DOWNLOAD_DIR, "%(id)s.%(ext)s"),
        "merge_output_format": "mp4",
        "overwrites": True,
        "skip_download": not download,
        "max_filesize": settings.MAX_MEDIA_DOWNLOAD_MB * 1024 * 1024,
        # yt-dlp has no default socket timeout, and asyncio.wait_for cannot kill the thread —
        # socket_timeout is what actually frees it.
        "socket_timeout": 30,
    }
    return opts


# Wall-clock budgets (s). Download + metadata expiry just ends that tier; nothing is lost.
DOWNLOAD_TIMEOUT_SECONDS = 30
META_TIMEOUT_SECONDS = 25
FFMPEG_TIMEOUT_SECONDS = 20
TRANSCRIBE_TIMEOUT_SECONDS = 60
# A caption + title shorter than this is "thin" (process.py uses it for the pre-classify gate).
THIN_CHARS = 120
# ponytail: Whisper hallucinates on silence/music; under this many words counts as no speech.
MIN_SPEECH_WORDS = 15
_FRAMES = 8


def _download(url: str, workdir: str | None = None) -> tuple[str | None, dict]:
    with yt_dlp.YoutubeDL(_ydl_opts(download=True, workdir=workdir)) as ydl:
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


def _metadata(info: dict, url: str) -> dict:
    return {
        "title": info.get("title") or info.get("fulltitle") or "Untitled",
        "author": info.get("uploader") or info.get("creator") or info.get("channel"),
        "platform": _platform(url),
        "duration": int(info.get("duration") or 0),
        "caption": (info.get("description") or "")[:_CAPTION_MAX],
    }


async def _fetch_image_parts(urls: list[str], *, cap_mb: int = 8) -> list[dict]:
    """Download image bytes (carousel slides / og:image) to hand Gemini as vision input.
    Net-guarded and size-capped like every outbound fetch; best-effort per image — a slide
    that fails is skipped rather than failing the whole capture. Returns
    [{"mime_type", "data"}] in input order."""
    parts: list[dict] = []
    cap = cap_mb * 1024 * 1024
    for u in urls:
        if not u:
            continue
        try:
            async with guarded_async_client(timeout=20.0, follow_redirects=True) as client:
                resp = await client.get(u, headers={"User-Agent": _CRAWLER_UA})
            resp.raise_for_status()
            data = resp.content
            if not data or len(data) > cap:
                continue
            ct = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
            if not ct.startswith("image/"):
                ext = u.split("?")[0].rsplit(".", 1)[-1].lower()
                ct = _IMAGE_MIME.get(ext, "image/jpeg")
            parts.append({"mime_type": ct, "data": data})
        except Exception as e:
            log.info("carousel image fetch failed (%s): %s", u[:80], str(e)[:120])
    return parts


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
    """Build a note from the post's public og: tags when every richer tier is blocked.

    Link-preview crawlers get og:title/og:description (the caption)/og:image for public posts;
    Instagram also has a tokenless oEmbed endpoint. If neither yields real text (a login wall
    serves only the generic site title) the result is `private_or_blocked` — NEVER `text=url`,
    which would let the model hallucinate a whole note from the URL slug.
    """
    platform = _platform(url)
    title = caption = image = None
    via = "og"
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
    if title and title.strip().lower() in _BLOCKED_OG_TITLES:
        title = caption = image = None  # login wall: its description/logo are wall copy too
    if caption and any(p in caption.lower() for p in _BLOCKED_OG_DESCRIPTIONS):
        caption = image = None
    if not caption and platform == "instagram":
        try:
            async with guarded_async_client(timeout=10.0, follow_redirects=True) as client:
                r = await client.get(
                    "https://graph.facebook.com/v25.0/instagram_oembed?omitscript=true&url="
                    + quote(url, safe=""), headers={"User-Agent": _CRAWLER_UA})
            r.raise_for_status()
            oe = r.json()
            caption = oe.get("title") or None
            title = title or oe.get("author_name")
            image = image or oe.get("thumbnail_url")
            via = "oembed" if caption else via
        except Exception as e:
            log.info("instagram oembed failed for %s: %s", url, str(e)[:160])

    text = "\n\n".join(p for p in (title, caption) if p).strip()
    if not caption:  # a title or generic logo alone is not content
        return _blocked_bundle(url, platform)
    # The one og:image goes to the vision model too: for an image post that IS the content.
    image_parts = await _fetch_image_parts([image]) if image else []
    return ContentBundle(
        kind="text",
        text=text or None,
        images=[image] if image else [],
        image_parts=image_parts,
        metadata={"title": title or platform, "platform": platform, "caption": caption or "",
                  "via": via},
        strategy="social_og",
    )


async def _download_media(media_url: str, workdir: str | None = None) -> str | None:
    """Stream a media URL (a CDN URL or an Apify-hosted `downloadedVideo`) to a temp file —
    size-capped and net-guarded like every other outbound fetch. Apify key-value-store URLs
    need the API token appended. Returns the path, or None on any failure."""
    if "api.apify.com" in media_url and settings.APIFY_TOKEN and "token=" not in media_url:
        sep = "&" if "?" in media_url else "?"
        media_url = f"{media_url}{sep}token={settings.APIFY_TOKEN}"
    dest = os.path.join(workdir or settings.TEMP_DOWNLOAD_DIR, f"{uuid.uuid4()}.mp4")
    ok = False
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
        ok = True
        return dest
    except Exception as e:
        log.warning("apify media download failed: %s: %s", type(e).__name__, str(e)[:160])
        return None
    finally:  # also runs on CancelledError (wait_for timeout), which `except Exception` misses
        if not ok and os.path.exists(dest):
            try:
                os.remove(dest)
            except OSError:
                pass


async def _meta_ytdlp(url: str) -> dict:
    """yt-dlp metadata only (skip_download). {} on any failure/timeout."""
    def _go() -> dict:
        with yt_dlp.YoutubeDL(_ydl_opts(download=False)) as ydl:
            return ydl.extract_info(url, download=False) or {}
    try:
        return await asyncio.wait_for(asyncio.to_thread(_go), timeout=META_TIMEOUT_SECONDS)
    except Exception as e:
        log.info("yt-dlp metadata failed for %s (%s): %s", _platform(url), url, str(e)[:160])
        return {}


async def _apify_tier(url: str) -> ContentBundle | None:
    """Paid third-party scrape (residential proxies + accounts): caption, latestComments, media
    url, carousel slides. Returns None to fall through — no token/actor, daily cap hit, empty
    result, or any error. A video post becomes a `reel_caption` bundle carrying `media_url` for
    the later transcript/frame tiers; a carousel/image post keeps `apify_carousel/_caption`."""
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
        "caption": (result.get("caption") or "")[:_CAPTION_MAX],
        "via": "apify",
    }
    image_urls = result.get("images") or (
        [result["thumbnail"]] if result.get("thumbnail") else [])
    is_video = bool(result.get("video_url")) and len(image_urls) <= 1
    # A reel's thumbnail is only a cover — do not route a video post to the vision model on it.
    image_parts = [] if is_video else await _fetch_image_parts(image_urls)
    text = "\n\n".join(p for p in (result.get("title"), meta["caption"]) if p).strip()
    if comments := result.get("comments"):
        meta["comments"] = len(comments)
        text += "\n\nTop comments (may contain the full recipe):\n" + "\n".join(
            f"- {c}" for c in comments)
        text = text.strip()
    if not text and not image_parts:
        return None  # nothing usable; let og-caption try
    meta["slides"] = len(image_parts)
    if is_video:
        meta.update(media_url=result["video_url"], tier="caption")
        strategy = "reel_caption"
    else:
        strategy = "apify_carousel" if len(image_parts) > 1 else "apify_caption"
    return ContentBundle(
        kind="text", text=text or None,
        images=image_urls[:1] if image_urls else [],   # cover = first slide
        image_parts=image_parts, metadata=meta, strategy=strategy,
    )


async def acquire(url: str) -> ContentBundle:
    """Tier 1 (caption + comments), also non-reel posts / TikTok / FB. Never raises for a
    blocked source — the last rung returns `private_or_blocked`."""
    # Instagram non-reel posts (/p/, /tv/) are Apify-first: the post scraper returns the caption
    # + EVERY carousel slide as vision input, where yt-dlp on a mixed carousel only gets the
    # single video slide. Reels/TikTok/FB stay yt-dlp-first (free). Bounded by APIFY_DAILY_GLOBAL_CAP.
    apify_first = _platform(url) == "instagram" and "/reel" not in url.lower()
    apify_tried = False
    if apify_first:
        apify_tried = True
        if (b := await _apify_tier(url)) is not None:
            return b

    info = await _meta_ytdlp(url)
    ytdlp_bundle = None
    if info:
        meta = _metadata(info, url)
        meta.update(via="ytdlp", tier="caption")
        thumb = info.get("thumbnail")
        ytdlp_bundle = ContentBundle(
            kind="text", text=meta["caption"] or None,
            images=[thumb] if thumb else [], metadata=meta, strategy="reel_caption")
        if len(meta["caption"]) >= THIN_CHARS:
            return ytdlp_bundle   # T1 passes: free caption is enough to try extraction

    # Caption thin or yt-dlp blocked: one Apify call (comments often hold the recipe).
    if not apify_tried and (b := await _apify_tier(url)) is not None:
        return b
    # Captionless: text=None (never yt-dlp's "Video by <user>" title) so process.py's gate
    # escalates to transcript/frames and fails the job if those yield nothing either.
    if ytdlp_bundle is not None:
        return ytdlp_bundle
    return await _caption_fallback(url)


# ---------- escalation tiers (T2 transcript, T3 frames) ----------

async def _ffmpeg(*args: str) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    try:
        await asyncio.wait_for(proc.wait(), timeout=FFMPEG_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return False
    return proc.returncode == 0


async def _fetch_media(url: str, bundle: ContentBundle) -> str | None:
    """ONE ≤360p ≤25 MB download per job, cached on the bundle (a failure is cached too).
    Apify's media url when we have it (fetchable from any IP), else yt-dlp."""
    m = bundle.metadata
    if "media_path" in m:
        return m["media_path"] or None
    m["media_path"] = ""
    if (m.get("duration") or 0) > settings.MAX_VIDEO_SECONDS:
        return None
    # Everything lands in the per-job workdir so cleanup() removes partial/orphaned files.
    workdir = m.get("workdir") or tempfile.mkdtemp(dir=settings.TEMP_DOWNLOAD_DIR)
    m["workdir"] = workdir
    try:
        if m.get("media_url"):
            path = await asyncio.wait_for(_download_media(m["media_url"], workdir),
                                          timeout=DOWNLOAD_TIMEOUT_SECONDS)
        else:
            path, _ = await asyncio.wait_for(asyncio.to_thread(_download, url, workdir),
                                             timeout=DOWNLOAD_TIMEOUT_SECONDS)
    except Exception as e:
        log.info("media download failed for %s: %s", url, str(e)[:160])
        return None
    if not path or not os.path.exists(path):
        return None
    dest = os.path.join(workdir, "in.mp4")
    shutil.move(path, dest)
    m["media_path"] = dest
    return dest


async def _audio_transcript(path: str, duration_s: int = 0) -> str | None:
    from services.gemini import gemini_service

    mp3 = os.path.join(os.path.dirname(path), "a.mp3")
    if not await _ffmpeg("-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000",
                         "-c:a", "libmp3lame", "-b:a", "32k", mp3):
        return None
    try:
        text = await asyncio.wait_for(asyncio.to_thread(gemini_service.transcribe, mp3, duration_s),
                                      timeout=TRANSCRIBE_TIMEOUT_SECONDS)
    except Exception as e:
        log.info("transcription failed: %s: %s", type(e).__name__, str(e)[:160])
        return None
    return text or None


async def _frames(path: str, duration: int) -> list[dict]:
    """≤8 frames, duration-aware (fps = min(1/2, 8/duration)), 768 px so overlay text reads."""
    fps = min(0.5, _FRAMES / duration) if duration else 0.5
    out = os.path.join(os.path.dirname(path), "f_%02d.jpg")
    await _ffmpeg("-y", "-i", path, "-vf", f"fps={fps:.4f},scale=768:-2",
                  "-frames:v", str(_FRAMES), "-q:v", "5", out)
    parts = []
    for f in sorted(glob.glob(os.path.join(os.path.dirname(path), "f_*.jpg")))[:_FRAMES]:
        with open(f, "rb") as fh:
            parts.append({"mime_type": "image/jpeg", "data": fh.read()})
    return parts


async def escalate(url: str, bundle: ContentBundle) -> ContentBundle | None:
    """Next tier for a `reel_*` bundle, reusing the one cached download. Returns None when
    there is nothing further to try (the caller keeps what it has)."""
    tier = bundle.metadata.get("tier", "caption")
    if tier == "frames":
        return None
    path = await _fetch_media(url, bundle)
    if not path:
        bundle.metadata["tier"] = "frames"
        return None
    text = bundle.text or ""
    if tier == "caption":
        bundle.metadata["tier"] = "transcript"
        tr = await _audio_transcript(path, int(bundle.metadata.get("duration") or 0))
        if tr and len(tr.split()) >= MIN_SPEECH_WORDS:
            text = (text + "\n\nSpoken transcript:\n" + tr).strip()
            return bundle.model_copy(update={"text": text, "strategy": "reel_transcript"})
    bundle.metadata["tier"] = "frames"
    frames = await _frames(path, int(bundle.metadata.get("duration") or 0))
    if not frames:
        return None
    return bundle.model_copy(update={"text": text, "image_parts": frames,
                                     "strategy": "reel_frames"})


def cleanup(bundle: ContentBundle | None) -> None:
    """Remove the job's temp dir (downloaded media, mp3, frames)."""
    if bundle and (d := bundle.metadata.get("workdir")):
        shutil.rmtree(d, ignore_errors=True)
