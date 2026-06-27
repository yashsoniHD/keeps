"""Direct user uploads (screenshot / image / PDF / voice) → GCS.

These arrive at /api/ingest/upload as multipart bytes, get parked in Cloud Storage, and
are handed to Gemini by gs:// URI in the worker (mirroring the social-video path). Two
destinations by intent:

  - Images go to the PUBLIC covers bucket so the saved image doubles as the note's cover
    (served to the browser by https URL). gs:// of the same object feeds Gemini.
  - PDFs / voice go to the PRIVATE media bucket — they are analysis inputs, not covers,
    and may be larger or more sensitive. Only a gs:// URI is returned.

Blocking GCS SDK calls — always invoke the async wrappers from request handlers.
"""
import asyncio
import uuid

from config import settings

# Per-input_type → (bucket setting, blob prefix, whether the object is publicly served).
_DEST = {
    "image": ("COVERS_BUCKET", "uploads/images", True),
    "pdf": ("CLOUD_STORAGE_BUCKET", "uploads/docs", False),
    "voice": ("CLOUD_STORAGE_BUCKET", "uploads/audio", False),
    "video": ("CLOUD_STORAGE_BUCKET", "uploads/video", False),
}

# Fallback file extensions when the client doesn't send a usable filename.
_SUFFIX = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "image/heic": ".heic", "image/heif": ".heif", "image/gif": ".gif",
    "application/pdf": ".pdf",
    "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/wav": ".wav",
    "audio/x-wav": ".wav", "audio/webm": ".webm", "audio/ogg": ".ogg",
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
    "video/x-matroska": ".mkv", "video/x-msvideo": ".avi", "video/mpeg": ".mpeg",
    "video/3gpp": ".3gp",
}


def bucket_for(input_type: str) -> str | None:
    """The configured bucket name for an input_type, or None if unset (uploads disabled)."""
    setting = _DEST.get(input_type)
    if not setting:
        return None
    return getattr(settings, setting[0], "") or None


def _upload_sync(data: bytes, *, bucket: str, prefix: str, mime: str) -> tuple[str, str]:
    from google.cloud import storage

    client = storage.Client(project=settings.GOOGLE_CLOUD_PROJECT)
    blob_name = f"{prefix}/{uuid.uuid4()}{_SUFFIX.get(mime, '')}"
    blob = client.bucket(bucket).blob(blob_name)
    blob.upload_from_string(data, content_type=mime)
    return (f"gs://{bucket}/{blob_name}",
            f"https://storage.googleapis.com/{bucket}/{blob_name}")


async def store_upload(input_type: str, data: bytes, mime: str) -> tuple[str, str | None]:
    """Upload bytes for an image/pdf/voice capture. Returns (gs_uri, cover_url):
    cover_url is the public https URL for images, None for private (pdf/voice)."""
    dest = _DEST[input_type]
    bucket = getattr(settings, dest[0], "")
    if not bucket:
        raise RuntimeError(f"No bucket configured for {input_type} uploads")
    gs_uri, public_url = await asyncio.to_thread(
        _upload_sync, data, bucket=bucket, prefix=dest[1], mime=mime
    )
    return gs_uri, (public_url if dest[2] else None)
