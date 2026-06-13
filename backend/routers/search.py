"""GET /api/search — semantic search over the user's notes via Firestore Vector Search.

Embeds the query (RETRIEVAL_QUERY), then runs a KNN `find_nearest` against the
`notes.embedding` field, pre-filtered to the caller's own notes. Returns the same
lightweight projection the feed/ask citations use — never the heavy `data` map or the
embedding vector itself.

Requires the Firestore vector index on `notes.embedding` (COSINE, user_id prefix) —
see infra/. Notes written before embeddings shipped won't match until backfilled.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, Query
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import get_db

log = logging.getLogger("clipnote.search")

router = APIRouter(tags=["search"])

# Same fields as the feed card / ask citation — enough to render a result, no `data`.
RESULT_FIELDS = ("id", "content_type", "title", "ai_summary", "source_domain", "cover_image_url")


@router.get("/search")
async def search(
    q: str = Query(..., min_length=1, max_length=200),
    user_id: str = Depends(require_user),
):
    q = q.strip()
    if not q:
        return {"results": []}

    try:
        query_vec = await embedding_service.embed_query(q)
    except Exception as e:
        log.error("query embedding failed: %s: %s", type(e).__name__, e, extra={"user_id": user_id})
        return {"results": []}
    if not query_vec:
        return {"results": []}

    db = get_db()
    vector_query = db.collection("notes").where("user_id", "==", user_id).find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_vec),
        distance_measure=DistanceMeasure.COSINE,
        limit=settings.SEARCH_LIMIT,
    )
    docs = [doc async for doc in vector_query.stream()]

    results = []
    for doc in docs:
        d = doc.to_dict() or {}
        results.append({
            "id": doc.id,
            "content_type": d.get("content_type", ""),
            "title": d.get("title", ""),
            "ai_summary": d.get("ai_summary", ""),
            "source_domain": d.get("source_domain", ""),
            "cover_image_url": d.get("cover_image_url"),
        })
    return {"results": results}
