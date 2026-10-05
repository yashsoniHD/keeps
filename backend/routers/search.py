"""GET /api/search — keyword + semantic search over the caller's own `notes`.

Keyword pass: one projected read of the user's newest notes, case-insensitive substring on
title/summary (Firestore has no substring index). Semantic pass: KNN `find_nearest` on
`notes.embedding`, pre-filtered by user_id (index: user_id + embedding, see infra/). Results are
merged (title hits, summary hits, then semantic) and deduped. Never returns `data`/embedding.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import firestore as fs
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import get_db
from services.source_alias import source_matches

log = logging.getLogger("keeps.search")

router = APIRouter(tags=["search"])

MIN_QUERY_LEN = 3
KEYWORD_SCAN_LIMIT = 500  # ponytail: newest 500 notes only; add a real text index if users outgrow it
KEYWORD_FIELDS = ["title", "ai_summary", "content_type", "cover_image_url", "source_domain", "created_at"]


def _project(doc_id: str, d: dict) -> dict:
    """Hit shape the frontend expects (SearchResult). `ref_id` = note id the UI routes to."""
    return {
        "id": doc_id,
        "content_type": d.get("content_type", ""),
        "title": d.get("title", ""),
        "ai_summary": d.get("ai_summary", ""),
        "source_domain": d.get("source_domain", ""),
        "cover_image_url": d.get("cover_image_url"),
        "ref_id": doc_id,
    }


async def _keyword_hits(db, user_id: str, q: str, *,
                        match_source: bool = False) -> tuple[list[dict], list[dict]]:
    """(source_hits, text_hits): brand-aware source_domain matches (when `match_source`), then
    title substring hits followed by summary substring hits, over the user's newest notes."""
    query = (
        db.collection("notes").where("user_id", "==", user_id).select(KEYWORD_FIELDS)
        .order_by("created_at", direction="DESCENDING").limit(KEYWORD_SCAN_LIMIT)
    )
    ql = q.lower()
    source_hits: list[dict] = []
    title_hits: list[dict] = []
    summary_hits: list[dict] = []
    async for doc in query.stream():
        d = doc.to_dict() or {}
        if match_source and source_matches(d.get("source_domain", ""), q):
            source_hits.append(_project(doc.id, d))
        if ql in (d.get("title") or "").lower():
            title_hits.append(_project(doc.id, d))
        elif ql in (d.get("ai_summary") or "").lower():
            summary_hits.append(_project(doc.id, d))
    return source_hits, [*title_hits, *summary_hits]


async def _enforce_search_caps(db, user_id: str) -> None:
    """Transactional per-user daily counter on search_count (each search embeds the query — a
    paid call). Raises 429 at the limit."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    transaction = db.transaction()

    @fs.async_transactional
    async def _bump(tx):
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        snap = await user_ref.get(transaction=tx)
        n = (snap.to_dict() or {}).get("search_count", 0)
        if n >= settings.MAX_SEARCHES_PER_USER_PER_DAY:
            raise HTTPException(429, "Daily search limit reached. Try again tomorrow.")
        tx.set(user_ref, {"user_id": user_id, "date": today, "search_count": n + 1}, merge=True)

    await _bump(transaction)


@router.get("/search")
async def search(
    q: str = Query(..., max_length=200),
    user_id: str = Depends(require_user),
):
    q = q.strip()
    if len(q) < MIN_QUERY_LEN:
        raise HTTPException(400, f"Query must be at least {MIN_QUERY_LEN} characters.")

    db = get_db()
    await _enforce_search_caps(db, user_id)

    source_hits: list[dict] = []
    text_hits: list[dict] = []
    try:
        source_hits, text_hits = await _keyword_hits(
            db, user_id, q, match_source=" " not in q and len(q) <= 20)
    except Exception as e:
        log.warning("keyword lookup failed: %s: %s", type(e).__name__, e, extra={"user_id": user_id})

    vector_hits: list[dict] = []
    try:
        query_vec = await embedding_service.embed_query(q)
        if query_vec:
            vector_query = db.collection("notes").where("user_id", "==", user_id).find_nearest(
                vector_field="embedding",
                query_vector=Vector(query_vec),
                distance_measure=DistanceMeasure.COSINE,
                limit=settings.SEARCH_LIMIT + 10,  # over-fetch: keyword hits dedupe some away
            )
            vector_hits = [_project(doc.id, doc.to_dict() or {}) async for doc in vector_query.stream()]
    except Exception as e:
        log.error("semantic search failed: %s: %s", type(e).__name__, e, extra={"user_id": user_id})

    seen: set[str] = set()
    results: list[dict] = []
    for d in (*source_hits, *text_hits, *vector_hits):
        if d["id"] not in seen:
            seen.add(d["id"])
            results.append(d)
    return {"results": results[: settings.SEARCH_LIMIT]}
