"""AI-generated note cover images (Vertex AI Imagen).

Last-resort cover when the source yields nothing — og:image, video frame, and first
<img> are all preferred (free, real). Gemini already emits a `cover_image_prompt` on
every note; we feed that here only when a note would otherwise be coverless AND
`ENABLE_IMAGEN` is on AND a daily cap hasn't been hit (see process.py).

Cost note (CLAUDE.md): Imagen is a real cost line, not the default. Generation is
best-effort — any failure (quota, RAI filter, transient) returns None and the note falls
back to the frontend's gradient hero.

Imagen is a REGIONAL model: unlike the Gemini 3.x chat models (global endpoint), it is
served from GOOGLE_CLOUD_LOCATION (us-central1), so this module holds its own client.
"""
import asyncio
import logging

from google import genai
from google.genai import types

from config import settings
from services.covers import upload_cover_bytes

log = logging.getLogger("clipnote.imagen")

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=settings.GOOGLE_CLOUD_PROJECT,
            location=settings.GOOGLE_CLOUD_LOCATION,  # regional — Imagen is NOT on global
        )
    return _client


def _generate_sync(prompt: str) -> str | None:
    resp = _get_client().models.generate_images(
        model=settings.IMAGEN_MODEL,
        prompt=prompt,
        config=types.GenerateImagesConfig(
            number_of_images=1,
            aspect_ratio="16:9",  # matches the detail-view hero (h-72/h-96, full width)
            output_mime_type="image/jpeg",
            person_generation="allow_adult",
        ),
    )
    images = resp.generated_images or []
    if not images:
        log.warning("imagen returned no images (prompt may have been RAI-filtered)")
        return None
    gen = images[0]
    if getattr(gen, "image", None) is None or not gen.image.image_bytes:
        log.warning("imagen image empty (rai_reason=%s)", getattr(gen, "rai_filtered_reason", None))
        return None
    return upload_cover_bytes(gen.image.image_bytes, ".jpg", "image/jpeg")


async def generate_cover(prompt: str, content_type: str) -> str | None:
    """Generate a cover image from a prompt, upload it, return the durable https URL.
    Best-effort: returns None on any failure (caller keeps the gradient fallback)."""
    if not settings.ENABLE_IMAGEN or not settings.COVERS_BUCKET or not prompt:
        return None
    try:
        url = await asyncio.to_thread(_generate_sync, prompt)
        if url:
            log.info("imagen cover generated (%s)", content_type)
        return url
    except Exception as e:  # noqa: BLE001 — covers are best-effort; never fail an ingest.
        log.warning("imagen generation failed (%s): %s: %s", content_type, type(e).__name__, e)
        return None
