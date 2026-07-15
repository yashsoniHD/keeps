"""The search index — one doc per note, each with its own embedding.

It's the single backbone for three features: semantic search (`routers/search.py`), Clip AI
grounding (`services/note_retrieval.py`), and the "recent saves" strip (client onSnapshot).

Doc id is `f"note-{note_id}"` so upsert/remove are O(1) and idempotent. All writes are
best-effort: a miss just means that entry is briefly absent from search until a backfill
re-indexes it; it must never break the capture.
"""
import logging
from datetime import datetime, timezone

from google.cloud.firestore_v1.vector import Vector

from services.embeddings import EMBED_TEXT_VERSION, embedding_service, note_embedding_text

log = logging.getLogger("clipnote.search_index")

COLLECTION = "search_index"


def _doc_id(kind: str, ref_id: str) -> str:
    return f"{kind}-{ref_id}"


async def _embed(title: str, summary: str, existing: Vector | None,
                 extra_text: str = "") -> Vector | None:
    """Reuse a caller-supplied embedding (e.g. the note's) to avoid a second embed call; otherwise
    embed title+summary, plus any `extra_text` (a note's flattened data) supplied. Non-fatal."""
    if existing is not None:
        return existing
    text = "\n".join(p for p in (title, summary, extra_text) if p).strip()
    if not text:
        return None
    try:
        vec = await embedding_service.embed_document(text)
        return Vector(vec) if vec else None
    except Exception as e:  # noqa: BLE001 — indexing is best-effort.
        log.warning("search_index embed failed: %s: %s", type(e).__name__, e)
        return None


async def upsert(db, *, user_id: str, kind: str, ref_id: str, title: str,
                 summary: str = "", cover_image_url: str | None = None,
                 content_type: str | None = None,
                 collection_id: str | None = None,
                 collection_ids: list[str] | None = None, created_at=None,
                 embedding: Vector | None = None, extra_text: str = "") -> None:
    """Create/replace the index entry for a note. Idempotent per (kind, ref_id).

    Carries collection membership two ways, kept coherent: the legacy scalar `collection_id`
    (deprecated shim, first match or null) and the multi-membership `collection_ids` array.

    `extra_text` is folded into the fallback embed (when no vector is supplied) so the index can
    match a note's flattened `data`, not just its title/summary."""
    try:
        now = datetime.now(timezone.utc)
        vec = await _embed(title, summary, embedding, extra_text)
        doc = {
            "user_id": user_id,
            "kind": kind,
            "ref_id": ref_id,
            "content_type": content_type or "",
            "collection_id": collection_id,
            "collection_ids": collection_ids or [],
            "title": title or "",
            "summary": summary or "",
            "cover_image_url": cover_image_url,
            "created_at": created_at or now,
            "updated_at": now,
        }
        if vec is not None:
            doc["embedding"] = vec
            doc["embedding_version"] = EMBED_TEXT_VERSION
        await db.collection(COLLECTION).document(_doc_id(kind, ref_id)).set(doc)
    except Exception as e:  # noqa: BLE001 — never let indexing break the capture.
        log.warning("search_index upsert failed (%s %s): %s: %s",
                    kind, ref_id, type(e).__name__, e)


async def upsert_for_note(db, note_id: str, note_doc: dict,
                          embedding: Vector | None = None) -> None:
    """Index a note, reusing its already-computed embedding when available. When it isn't, the
    fallback embed folds in the note's flattened `data` (same recipe as the note's own vector)."""
    await upsert(
        db, user_id=note_doc["user_id"], kind="note", ref_id=note_id,
        title=note_doc.get("title", ""), summary=note_doc.get("ai_summary", ""),
        cover_image_url=note_doc.get("cover_image_url"),
        content_type=note_doc.get("content_type", ""),
        collection_id=note_doc.get("collection_id"),
        collection_ids=note_doc.get("collection_ids"),
        created_at=note_doc.get("created_at"), embedding=embedding,
        extra_text=note_embedding_text("", "", note_doc.get("data")),
    )


async def remove(db, kind: str, ref_id: str) -> None:
    """Drop an index entry on note delete. Best-effort."""
    try:
        await db.collection(COLLECTION).document(_doc_id(kind, ref_id)).delete()
    except Exception as e:  # noqa: BLE001
        log.warning("search_index remove failed (%s %s): %s: %s",
                    kind, ref_id, type(e).__name__, e)
