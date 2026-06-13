"""Durable note cover images.

Source thumbnails (especially Instagram/TikTok) are hot-linked, time-signed URLs that
404 within days — so a note that *had* a cover goes blank. We re-host covers in a
public GCS bucket (`COVERS_BUCKET`) and store the resulting https URL on the note.

Two entry points:
  - persist_cover(src_url): fetch a remote image (through the SSRF guard, since the URL
    came from a scraped page) and re-upload it; returns a durable public https URL.
  - extract_video_frame(file_path): grab a single frame via ffmpeg for videos that have
    no usable thumbnail (the file is already downloaded for analysis).
"""
import asyncio
import logging
import os
import subprocess
import uuid

from config import settings
from services.net_guard import assert_public_url_async, guarded_async_client

log = logging.getLogger("clipnote.covers")

_MAX_COVER_BYTES = 10 * 1024 * 1024  # 10 MB — covers are small; cap defends the worker.


def _public_url(bucket: str, blob_name: str) -> str:
    return f"https://storage.googleapis.com/{bucket}/{blob_name}"


def upload_cover_bytes(data: bytes, suffix: str, content_type: str) -> str:
    """Upload raw image bytes to the public covers bucket; return the durable https URL.
    Synchronous (blocking GCS SDK) — call via asyncio.to_thread from async code."""
    from google.cloud import storage

    client = storage.Client(project=settings.GOOGLE_CLOUD_PROJECT)
    bucket = client.bucket(settings.COVERS_BUCKET)
    blob_name = f"covers/{uuid.uuid4()}{suffix}"
    blob = bucket.blob(blob_name)
    blob.upload_from_string(data, content_type=content_type)
    return _public_url(settings.COVERS_BUCKET, blob_name)


# Back-compat alias for existing call sites within this module.
_upload_cover = upload_cover_bytes


async def persist_cover(src_url: str) -> str | None:
    """Re-host a remote cover image in the public covers bucket. Returns the durable
    https URL, or None if anything fails (caller keeps the original URL as fallback)."""
    if not settings.COVERS_BUCKET or not src_url or not src_url.startswith(("http://", "https://")):
        return None
    try:
        await assert_public_url_async(src_url)  # SSRF: cover URL came from a scraped page.
        async with guarded_async_client(timeout=15, follow_redirects=True) as client:
            resp = await client.get(src_url)
            resp.raise_for_status()
            data = resp.content
            if not data or len(data) > _MAX_COVER_BYTES:
                return None
            content_type = (resp.headers.get("content-type") or "image/jpeg").split(";")[0].strip()
            if not content_type.startswith("image/"):
                return None
        suffix = os.path.splitext(src_url.split("?")[0])[1][:5] or ".jpg"
        return await asyncio.to_thread(_upload_cover, data, suffix, content_type)
    except Exception as e:  # noqa: BLE001 — covers are best-effort; never fail an ingest.
        log.warning("cover persist failed (%s): %s: %s", src_url, type(e).__name__, e)
        return None


def _extract_frame_sync(file_path: str) -> str | None:
    out_path = os.path.join(settings.TEMP_DOWNLOAD_DIR, f"{uuid.uuid4()}.jpg")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-ss", "00:00:01", "-i", file_path, "-frames:v", "1",
             "-q:v", "3", out_path],
            check=True, capture_output=True, timeout=30,
        )
    except (subprocess.SubprocessError, OSError) as e:
        log.warning("ffmpeg frame extract failed: %s: %s", type(e).__name__, e)
        return None
    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        return None
    try:
        with open(out_path, "rb") as fh:
            return _upload_cover(fh.read(), ".jpg", "image/jpeg")
    finally:
        if os.path.exists(out_path):
            try:
                os.remove(out_path)
            except OSError:
                pass


async def extract_video_frame(file_path: str) -> str | None:
    """Extract a single frame (~1s in) from a downloaded video and upload it as a cover.
    Returns the public https URL or None. Best-effort — never raises."""
    if not settings.COVERS_BUCKET or not file_path or not os.path.exists(file_path):
        return None
    return await asyncio.to_thread(_extract_frame_sync, file_path)
