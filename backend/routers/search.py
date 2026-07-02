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
from services import search_index
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import get_db
from services.source_alias import source_matches

log = logging.getLogger("clipnote.search")

router = APIRouter(tags=["search"])

# Same fields as the feed card / ask citation — enough to render a result, no `data`.
RESULT_FIELDS = ("id", "content_type", "title", "ai_summary", "source_domain", "cover_image_url")


def _project(doc_id: str, d: dict) -> dict:
    """Project a plain note. app=None + ref_id=id → the UI routes it to /notes/$id."""
    return {
        "id": doc_id,
        "content_type": d.get("content_type", ""),
        "title": d.get("title", ""),
        "ai_summary": d.get("ai_summary", ""),
        "source_domain": d.get("source_domain", ""),
        "cover_image_url": d.get("cover_image_url"),
        "app": None,
        "ref_id": doc_id,
    }


def _project_index(d: dict) -> dict:
    """Project a search_index hit (note OR mini-app item). For items, `app` + `ref_id` let the UI
    route to /<app>/$itemId; notes carry app=None. `id` is the underlying doc id (ref_id)."""
    ref_id = d.get("ref_id", "")
    app = d.get("app")  # None for notes
    return {
        "id": ref_id,
        "content_type": d.get("kind") if app else "",
        "title": d.get("title", ""),
        "ai_summary": d.get("summary", ""),
        "source_domain": "",
        "cover_image_url": d.get("cover_image_url"),
        "app": app,
        "ref_id": ref_id,
    }


async def _notes_by_source(db, user_id: str, keyword: str) -> list[dict]:
    """Notes saved from a named brand ("pinterest" → pin.it links). Scans the newest notes
    (existing user_id+created_at index) and filters in Python — Firestore can't substring-
    match. Brand-aware via source_alias, so short-link domains count."""
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING").limit(300)
    )
    out = []
    async for doc in query.stream():
        d = doc.to_dict() or {}
        if source_matches(d.get("source_domain", ""), keyword):
            out.append(_project(doc.id, d))
            if len(out) >= settings.SEARCH_LIMIT:
                break
    return out


@router.get("/search")
async def search(
    q: str = Query(..., min_length=1, max_length=200),
    user_id: str = Depends(require_user),
):
    q = q.strip()
    if not q:
        return {"results": []}

    db = get_db()

    # A one-word query is often a source name ("pinterest", "youtube"). Vector search alone
    # misses these — a recipe note isn't semantically "pinterest" — so look up notes by brand
    # and surface them first, ahead of the semantic results.
    source_hits: list[dict] = []
    if " " not in q and len(q) <= 20:
        try:
            source_hits = await _notes_by_source(db, user_id, q)
        except Exception as e:
            log.warning("source lookup failed: %s: %s", type(e).__name__, e, extra={"user_id": user_id})

    vector_hits: list[dict] = []
    try:
        query_vec = await embedding_service.embed_query(q)
    except Exception as e:
        log.error("query embedding failed: %s: %s", type(e).__name__, e, extra={"user_id": user_id})
        query_vec = None
    if query_vec:
        # Search the unified index so results span notes AND mini-app items (recipes, movies,
        # products, places, trips) that no longer create note docs.
        vector_query = db.collection(search_index.COLLECTION).where(
            "user_id", "==", user_id).find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vec),
            distance_measure=DistanceMeasure.COSINE,
            limit=settings.SEARCH_LIMIT,
        )
        vector_hits = [_project_index(doc.to_dict() or {}) async for doc in vector_query.stream()]

    # Source matches first (exact intent), then semantic, deduped by underlying doc id and capped.
    seen, results = set(), []
    for d in (*source_hits, *vector_hits):
        if d["id"] in seen:
            continue
        seen.add(d["id"])
        results.append(d)
    return {"results": results[: settings.SEARCH_LIMIT]}
