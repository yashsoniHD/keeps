"""The unified search index — one doc per note OR mini-app item, each with its own embedding.

It's the single backbone for three features: semantic search (`routers/search.py`), Clip AI
grounding (`services/note_retrieval.py`), and the Library "recent saves" strip (client onSnapshot).
Because mini-app captures no longer create note docs, this is how their content stays searchable and
answerable.

Doc id is `f"{kind}-{ref_id}"` so upsert/remove are O(1) and idempotent — re-saving a deduped movie
updates its entry instead of duplicating it. All writes are best-effort: a miss just means that entry
is briefly absent from search until a backfill re-indexes it; it must never break the capture.
"""
import logging
from datetime import datetime, timezone

from google.cloud.firestore_v1.vector import Vector

from services.embeddings import embedding_service

log = logging.getLogger("clipnote.search_index")

COLLECTION = "search_index"

# kind -> the mini-app it routes to (notes have no app).
APP_BY_KIND = {
    "watch": "watchlist",
    "wish": "wishlist",
    "recipe": "recipes",
    "place": "places",
    "trip": "trips",
}


def _doc_id(kind: str, ref_id: str) -> str:
    return f"{kind}-{ref_id}"


async def _embed(title: str, summary: str, existing: Vector | None) -> Vector | None:
    """Reuse a caller-supplied embedding (e.g. the note's) to avoid a second embed call; otherwise
    embed title+summary. Non-fatal."""
    if existing is not None:
        return existing
    text = "\n".join(p for p in (title, summary) if p).strip()
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
                 collection_id: str | None = None, created_at=None,
                 embedding: Vector | None = None) -> None:
    """Create/replace the index entry for a note or item. Idempotent per (kind, ref_id)."""
    try:
        now = datetime.now(timezone.utc)
        vec = await _embed(title, summary, embedding)
        doc = {
            "user_id": user_id,
            "kind": kind,
            "ref_id": ref_id,
            "app": APP_BY_KIND.get(kind),  # None for plain notes
            "collection_id": collection_id,
            "title": title or "",
            "summary": summary or "",
            "cover_image_url": cover_image_url,
            "created_at": created_at or now,
            "updated_at": now,
        }
        if vec is not None:
            doc["embedding"] = vec
        await db.collection(COLLECTION).document(_doc_id(kind, ref_id)).set(doc)
    except Exception as e:  # noqa: BLE001 — never let indexing break the capture.
        log.warning("search_index upsert failed (%s %s): %s: %s",
                    kind, ref_id, type(e).__name__, e)


async def upsert_for_note(db, note_id: str, note_doc: dict,
                          embedding: Vector | None = None) -> None:
    """Index a plain note, reusing its already-computed embedding when available."""
    await upsert(
        db, user_id=note_doc["user_id"], kind="note", ref_id=note_id,
        title=note_doc.get("title", ""), summary=note_doc.get("ai_summary", ""),
        cover_image_url=note_doc.get("cover_image_url"),
        collection_id=note_doc.get("collection_id"),
        created_at=note_doc.get("created_at"), embedding=embedding,
    )


async def remove(db, kind: str, ref_id: str) -> None:
    """Drop an index entry on note/item delete. Best-effort."""
    try:
        await db.collection(COLLECTION).document(_doc_id(kind, ref_id)).delete()
    except Exception as e:  # noqa: BLE001
        log.warning("search_index remove failed (%s %s): %s: %s",
                    kind, ref_id, type(e).__name__, e)
