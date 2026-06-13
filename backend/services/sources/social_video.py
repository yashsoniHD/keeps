"""Instagram reels/posts, Facebook video, TikTok: download via yt-dlp → GCS → gs:// URI.

These platforms cannot be analyzed by Gemini directly (unlike YouTube), so the video is
downloaded at ≤480p, uploaded to Cloud Storage, and handed to Gemini by gs:// URI —
never inline bytes (the ~20 MB inline cap fails most videos).

Instagram/Facebook typically require session cookies; configured via YTDLP_COOKIES_FILE
(Secret Manager on Cloud Run) or YTDLP_COOKIES_FROM_BROWSER (local dev). The caption/
metadata fallback path still works cookie-less for many public posts.
"""
import asyncio
import os
import uuid

import yt_dlp

from config import settings
from models.note import ContentBundle

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
    if settings.YTDLP_COOKIES_FILE:
        opts["cookiefile"] = settings.YTDLP_COOKIES_FILE
    elif settings.YTDLP_COOKIES_FROM_BROWSER:
        opts["cookiesfrombrowser"] = (settings.YTDLP_COOKIES_FROM_BROWSER,)
    return opts


def _download(url: str) -> tuple[str | None, dict]:
    with yt_dlp.YoutubeDL(_ydl_opts(download=True)) as ydl:
        info = ydl.extract_info(url, download=True)
        if not info:
            return None, {}
        filename = ydl.prepare_filename(info)
        base = os.path.splitext(filename)[0]
        file_path = next(
            (p for ext in ("mp4", "mkv", "webm", "m4a")
             if os.path.exists(p := f"{base}.{ext}")),
            filename if os.path.exists(filename) else None,
        )
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


async def acquire(url: str) -> ContentBundle:
    file_path = None
    try:
        file_path, info = await asyncio.to_thread(_download, url)
        meta = _metadata(info, url)

        images: list[str] = []
        if file_path:
            # Durable cover from local bytes — Instagram's CDN thumbnail is referer-gated,
            # datacenter-IP blocked, and time-signed (expires in days). A frame from the
            # file we already downloaded is reliable and permanent.
            from services.covers import extract_video_frame
            frame_url = await extract_video_frame(file_path)
            if frame_url:
                images = [frame_url]
        # Fallback only when we have no local frame: the platform thumbnail URL
        # (process.py will attempt to re-host it; placeholder if that also fails).
        if not images and info.get("thumbnail"):
            images = [info["thumbnail"]]

        if file_path and settings.CLOUD_STORAGE_BUCKET:
            gcs_uri = await asyncio.to_thread(_upload_to_gcs, file_path)
            return ContentBundle(
                kind="video_uri", video_uri=gcs_uri,
                text=meta["caption"] or None,
                images=images, metadata=meta, strategy="ytdlp_gcs",
            )

        # No file (download blocked) or no bucket configured: caption/metadata fallback.
        text = meta["caption"] or meta["title"]
        return ContentBundle(
            kind="text", text=text, images=images, metadata=meta,
            strategy="social_caption",
        )
    finally:
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
