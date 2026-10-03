"""Note-search embeddings for Firestore Vector Search, via OpenRouter `/embeddings`.

Mirrors the gemini.py service shape: a sync OpenAI client, calls wrapped in
`asyncio.to_thread` so they don't stall the event loop.

Qwen3-embedding is asymmetric: documents (notes) are embedded as-is, search queries carry an
instruction prefix (replaces Vertex's RETRIEVAL_DOCUMENT/RETRIEVAL_QUERY task types) —
embedding both the same way measurably degrades recall.
"""
import asyncio
import json
import logging
import math

from openai import OpenAI

from config import settings
from services.usage_meter import record_usage

log = logging.getLogger("clipnote.embeddings")

# Bump whenever `note_embedding_text` changes what goes into the vector, so a backfill can tell
# which notes were embedded under the old recipe and re-embed only those.
EMBED_TEXT_VERSION = 3  # 3 = qwen3-embedding (OpenRouter) re-index


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


_warned_trunc = False
QUERY_PREFIX = "Instruct: Given a search query, retrieve relevant saved notes\nQuery: "


class EmbeddingService:
    def __init__(self):
        self.client = OpenAI(base_url="https://openrouter.ai/api/v1",
                             api_key=settings.OPENROUTER_API_KEY or "unset",
                             max_retries=0, timeout=60)

    async def _embed(self, text: str) -> list[float]:
        text = (text or "").strip()
        if not text:
            return []
        resp = await asyncio.to_thread(
            self.client.embeddings.create,
            model=settings.EMBED_MODEL,
            input=[text],
            dimensions=settings.EMBED_DIM,
        )
        record_usage(settings.EMBED_MODEL, resp)
        vec = list(resp.data[0].embedding)
        dim = settings.EMBED_DIM
        if len(vec) > dim:
            # Provider ignored `dimensions`: Matryoshka-truncate + re-normalize.
            global _warned_trunc
            if not _warned_trunc:
                _warned_trunc = True
                log.warning("embedding returned %d dims; truncating to %d", len(vec), dim)
            vec = vec[:dim]
            norm = math.sqrt(sum(x * x for x in vec)) or 1.0
            vec = [x / norm for x in vec]
        # A silently-wrong dimension would poison the vector index — fail loudly instead.
        if len(vec) != settings.EMBED_DIM:
            raise ValueError(f"embedding dim {len(vec)} != EMBED_DIM {settings.EMBED_DIM}")
        return vec

    async def embed_document(self, text: str) -> list[float]:
        """Embed a note for storage. Caller treats failures as non-fatal."""
        return await self._embed(text)

    async def embed_query(self, text: str) -> list[float]:
        """Embed a search query for find_nearest."""
        if not (text or "").strip():
            return []
        return await self._embed(QUERY_PREFIX + text.strip())


embedding_service = EmbeddingService()
