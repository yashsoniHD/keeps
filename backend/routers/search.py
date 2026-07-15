"""GET /api/search — semantic search over the user's notes via Firestore Vector Search.

Embeds the query (RETRIEVAL_QUERY), then runs a KNN `find_nearest` against the
`notes.embedding` field, pre-filtered to the caller's own notes. Returns the same
lightweight projection the feed/ask citations use — never the heavy `data` map or the
embedding vector itself.

Requires the Firestore vector index on `notes.embedding` (COSINE, user_id prefix) —
see infra/. Notes written before embeddings shipped won't match until backfilled.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud import firestore as fs
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from services import search_index
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import flush_usage, get_db
from services.source_alias import source_matches
from services.usage_meter import start_metering

log = logging.getLogger("clipnote.search")

router = APIRouter(tags=["search"])

# Same fields as the feed card / ask citation — enough to render a result, no `data`.
RESULT_FIELDS = ("id", "content_type", "title", "ai_summary", "source_domain", "cover_image_url")


def _project(doc_id: str, d: dict) -> dict:
    """Project a note doc. `ref_id` = the note id the UI routes to (/notes/$id)."""
    return {
        "id": doc_id,
        "content_type": d.get("content_type", ""),
        "title": d.get("title", ""),
        "ai_summary": d.get("ai_summary", ""),
        "source_domain": d.get("source_domain", ""),
        "cover_image_url": d.get("cover_image_url"),
        "ref_id": doc_id,
    }


def _project_index(d: dict) -> dict:
    """Project a search_index hit (one per note). Older index docs predate the stored
    content_type and fall back to "" — a backfill re-index fills them in."""
    ref_id = d.get("ref_id", "")
    return {
        "id": ref_id,
        "content_type": d.get("content_type", ""),
        "title": d.get("title", ""),
        "ai_summary": d.get("summary", ""),
        "source_domain": "",
        "cover_image_url": d.get("cover_image_url"),
        "ref_id": ref_id,
    }


async def _keyword_hits(db, user_id: str, q: str, *,
                        match_source: bool) -> tuple[list[dict], list[dict]]:
    """One pass over the user's newest notes collecting cheap exact-intent matches Firestore
    can't do server-side (no substring index):
      - source hits: notes saved from a named brand ("pinterest" → pin.it links), brand-aware
        via source_alias so short-link domains count. Only when `match_source` (the query looks
        like a brand name — see the caller's gating).
      - title hits: notes whose title contains the query as a substring.
    Returns (source_hits, title_hits), each capped at SEARCH_LIMIT, in one Firestore read."""
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING").limit(300)
    )
    ql = q.lower()
    source_hits: list[dict] = []
    title_hits: list[dict] = []
    async for doc in query.stream():
        d = doc.to_dict() or {}
        if match_source and len(source_hits) < settings.SEARCH_LIMIT and \
                source_matches(d.get("source_domain", ""), q):
            source_hits.append(_project(doc.id, d))
        if len(title_hits) < settings.SEARCH_LIMIT and ql in d.get("title", "").lower():
            title_hits.append(_project(doc.id, d))
    return source_hits, title_hits


async def _enforce_search_caps(db, user_id: str) -> None:
    """Transactional per-user daily counter on search_count. Each search embeds the query —
    a paid Vertex call (tiny, but real and previously unbounded) — so it gets the same
    counter treatment as every other paid path. Raises 429 at the limit."""
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
    q: str = Query(..., min_length=1, max_length=200),
    user_id: str = Depends(require_user),
):
    q = q.strip()
    if not q:
        return {"results": []}

    db = get_db()
    await _enforce_search_caps(db, user_id)
    # Meter the query embedding so search spend shows up in the admin dashboard.
    meter = start_metering()
    try:
        # Cheap exact-intent matches vector search alone misses: a one-word query is often a
        # source name ("pinterest" — a recipe note isn't semantically "pinterest"), and a short
        # query is often a literal title fragment. One Firestore pass collects both, surfaced
        # ahead of the semantic results.
        source_hits: list[dict] = []
        title_hits: list[dict] = []
        if len(q) <= 40:
            try:
                match_source = " " not in q and len(q) <= 20
                source_hits, title_hits = await _keyword_hits(
                    db, user_id, q, match_source=match_source)
            except Exception as e:
                log.warning("keyword lookup failed: %s: %s", type(e).__name__, e,
                            extra={"user_id": user_id})

        vector_hits: list[dict] = []
        try:
            query_vec = await embedding_service.embed_query(q)
        except Exception as e:
            log.error("query embedding failed: %s: %s", type(e).__name__, e, extra={"user_id": user_id})
            query_vec = None
        if query_vec:
            vector_query = db.collection(search_index.COLLECTION).where(
                "user_id", "==", user_id).find_nearest(
                vector_field="embedding",
                query_vector=Vector(query_vec),
                distance_measure=DistanceMeasure.COSINE,
                # Over-fetch: keyword hits above may dedup away several KNN results, so pull a few
                # extra to still fill SEARCH_LIMIT after the merge.
                limit=settings.SEARCH_LIMIT + 10,
            )
            vector_hits = [_project_index(doc.to_dict() or {}) async for doc in vector_query.stream()]

        # Source matches first (exact intent), then title substrings, then semantic — deduped by
        # underlying doc id and capped.
        seen, results = set(), []
        for d in (*source_hits, *title_hits, *vector_hits):
            if d["id"] in seen:
                continue
            seen.add(d["id"])
            results.append(d)
        return {"results": results[: settings.SEARCH_LIMIT]}
    finally:
        await flush_usage(user_id, meter)
