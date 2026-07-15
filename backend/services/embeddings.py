"""Vertex AI text embeddings for Firestore Vector Search (semantic note search).

Mirrors the gemini.py service shape: a single Vertex `genai.Client`, sync SDK calls
wrapped in `asyncio.to_thread` so they don't stall the event loop.

Two task types matter for retrieval quality: documents (notes) are embedded with
RETRIEVAL_DOCUMENT, the search query with RETRIEVAL_QUERY — embedding both the same way
measurably degrades recall. The embedding model is REGIONAL (us-central1), not on the
`global` endpoint the 3.x chat models use, so it gets its own client/location.
"""
import asyncio
import json
import logging

from google import genai
from google.genai import types

from config import settings
from services.usage_meter import record_usage

log = logging.getLogger("clipnote.embeddings")

# Bump whenever `note_embedding_text` changes what goes into the vector, so a backfill can tell
# which notes were embedded under the old recipe and re-embed only those.
EMBED_TEXT_VERSION = 2


def note_embedding_text(title: str, ai_summary: str, data: dict | None = None) -> str:
    """The text a note is embedded from: title + summary + a flattened `data` excerpt.

    Embedding title+summary alone made search match only headlines; folding in the structured
    `data` (ingredients, steps, listicle entries, specs, …) lets a query hit the note's actual
    content. Mirrors the digest flatten recipe (gemini.py) — `default=str` so Firestore
    timestamps/Vectors inside `data` serialize instead of raising."""
    text = "\n".join(p for p in (title.strip(), ai_summary.strip()) if p)
    if data:
        dump = json.dumps(data, ensure_ascii=False, default=str)[
            : settings.EMBED_NOTE_DATA_EXCERPT_CHARS]
        if dump and dump != "{}":
            text = f"{text}\n{dump}" if text else dump
    return text


class EmbeddingService:
    def __init__(self):
        self.client = genai.Client(
            vertexai=True,
            project=settings.GOOGLE_CLOUD_PROJECT,
            location=settings.EMBED_LOCATION,
        )

    async def _embed(self, text: str, task_type: str) -> list[float]:
        text = (text or "").strip()
        if not text:
            return []
        resp = await asyncio.to_thread(
            self.client.models.embed_content,
            model=settings.EMBED_MODEL,
            contents=[text],
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=settings.EMBED_DIM,
                # Notes now embed title+summary+data, which can exceed the model's token limit;
                # let the API clip to the limit instead of failing the whole embed.
                auto_truncate=True,
            ),
        )
        record_usage(settings.EMBED_MODEL, resp)
        return list(resp.embeddings[0].values)

    async def embed_document(self, text: str) -> list[float]:
        """Embed a note for storage. Caller treats failures as non-fatal."""
        return await self._embed(text, "RETRIEVAL_DOCUMENT")

    async def embed_query(self, text: str) -> list[float]:
        """Embed a search query for find_nearest."""
        return await self._embed(text, "RETRIEVAL_QUERY")


embedding_service = EmbeddingService()
