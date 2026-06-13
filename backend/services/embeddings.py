"""Vertex AI text embeddings for Firestore Vector Search (semantic note search).

Mirrors the gemini.py service shape: a single Vertex `genai.Client`, sync SDK calls
wrapped in `asyncio.to_thread` so they don't stall the event loop.

Two task types matter for retrieval quality: documents (notes) are embedded with
RETRIEVAL_DOCUMENT, the search query with RETRIEVAL_QUERY — embedding both the same way
measurably degrades recall. The embedding model is REGIONAL (us-central1), not on the
`global` endpoint the 3.x chat models use, so it gets its own client/location.
"""
import asyncio
import logging

from google import genai
from google.genai import types

from config import settings

log = logging.getLogger("clipnote.embeddings")


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
            ),
        )
        return list(resp.embeddings[0].values)

    async def embed_document(self, text: str) -> list[float]:
        """Embed a note for storage. Caller treats failures as non-fatal."""
        return await self._embed(text, "RETRIEVAL_DOCUMENT")

    async def embed_query(self, text: str) -> list[float]:
        """Embed a search query for find_nearest."""
        return await self._embed(text, "RETRIEVAL_QUERY")


embedding_service = EmbeddingService()
