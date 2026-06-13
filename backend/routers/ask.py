"""POST /api/ask — chat grounded in the user's saved notes.

Two-stage pattern mirroring the ingest pipeline (assign_category → extract):
the lite model picks relevant note ids from a compact index of all the user's
notes, then the main model answers from only those notes' full structured data.
Stateless: the client sends the conversation history with each request.
"""
import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore as fs
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from models.ask import AskRequest, AskResponse, Citation
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import flush_usage, get_db
from services.gemini import gemini_service
from services.usage_meter import start_metering

log = logging.getLogger("clipnote.ask")

router = APIRouter(tags=["ask"])

NO_NOTES_ANSWER = (
    "You haven't saved any notes yet — clip a few links first, then ask me about them."
)
NOTHING_FOUND_ANSWER = "I couldn't find anything in your notes about that."

# Index fields: everything the selection stage and citations need, WITHOUT the
# heavy `data` map (projection keeps the per-ask read cheap at the 500-note cap).
INDEX_FIELDS = ["content_type", "title", "ai_summary", "source_domain", "cover_image_url"]


async def _fetch_note_index(db, user_id: str) -> list[dict]:
    query = db.collection("notes").where("user_id", "==", user_id).select(INDEX_FIELDS)
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


async def _vector_shortlist(db, user_id: str, question: str) -> list[dict] | None:
    """Top-K candidate notes by semantic similarity to the question (Firestore Vector
    Search). Hybrid retrieval: this shortlist replaces loading the whole corpus, then the
    lite model still picks the final notes from it. Returns None when the query embedding
    is unavailable so the caller falls back to the full projected index (which also covers
    notes saved before embeddings existed)."""
    try:
        query_vec = await embedding_service.embed_query(question)
    except Exception as e:
        log.warning("ask shortlist embedding failed, falling back to full index: %s: %s",
                    type(e).__name__, e, extra={"user_id": user_id})
        return None
    if not query_vec:
        return None
    vector_query = db.collection("notes").where("user_id", "==", user_id).find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_vec),
        distance_measure=DistanceMeasure.COSINE,
        limit=settings.ASK_SHORTLIST_K,
    )
    return [
        {"id": doc.id, **{f: (doc.to_dict() or {}).get(f) for f in INDEX_FIELDS}}
        async for doc in vector_query.stream()
    ]


async def _fetch_notes_by_ids(db, user_id: str, ids: list[str]) -> list[dict]:
    snaps = await asyncio.gather(
        *(db.collection("notes").document(note_id).get() for note_id in ids)
    )
    notes = []
    for note_id, snap in zip(ids, snaps):
        data = snap.to_dict() if snap.exists else None
        if data and data.get("user_id") == user_id:
            notes.append({"id": note_id, **data})
    return notes


async def _enforce_ask_caps(db, user_id: str) -> None:
    """Same transactional counter pattern as ingest's _enforce_cost_caps, on
    ask_count fields of the same usage docs. Raises 429 when a limit is hit."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    transaction = db.transaction()

    @fs.async_transactional
    async def _bump(tx):
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("ask_count", 0)
        global_n = (global_snap.to_dict() or {}).get("ask_count", 0)
        if user_n >= settings.MAX_ASKS_PER_USER_PER_DAY:
            raise HTTPException(429, "Daily Ask AI limit reached. Try again tomorrow.")
        if global_n >= settings.DAILY_GLOBAL_ASK_CAP:
            raise HTTPException(429, "Ask AI is at capacity today. Try again tomorrow.")
        tx.set(user_ref, {"user_id": user_id, "date": today, "ask_count": user_n + 1}, merge=True)
        tx.set(global_ref, {"date": today, "ask_count": global_n + 1}, merge=True)

    await _bump(transaction)


@router.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest, user_id: str = Depends(require_user)):
    db = get_db()

    # Hybrid retrieval: a semantic vector shortlist first; fall back to the full projected
    # index if embeddings are unavailable or matched nothing (e.g. notes not yet embedded).
    index = await _vector_shortlist(db, user_id, body.question)
    if not index:
        index = await _fetch_note_index(db, user_id)
    if not index:
        # No AI cost incurred, so no cap consumed.
        return AskResponse(answer=NO_NOTES_ANSWER)

    await _enforce_ask_caps(db, user_id)

    # Meter both Gemini stages (select + answer); flushed once when the request ends.
    meter = start_metering()
    try:
        history = [t.model_dump() for t in body.history[-10:]]
        selection_index = [
            {
                "id": n["id"],
                "type": n.get("content_type", ""),
                "title": n.get("title", ""),
                "summary": (n.get("ai_summary") or "")[:200],
            }
            for n in index
        ]
        raw_ids = await gemini_service.select_notes(body.question, history[-4:], selection_index)

        # Keep only ids that exist in the index (drops hallucinated ids), preserving order.
        known = {n["id"] for n in index}
        ids = [i for i in dict.fromkeys(raw_ids) if i in known][: settings.ASK_MAX_GROUNDED_NOTES]
        if not ids:
            return AskResponse(answer=NOTHING_FOUND_ANSWER)

        notes = await _fetch_notes_by_ids(db, user_id, ids)
        if not notes:
            return AskResponse(answer=NOTHING_FOUND_ANSWER)

        try:
            grounded = await gemini_service.answer_from_notes(body.question, history, notes)
        except HTTPException:
            raise
        except Exception as e:
            log.error("ask answer stage failed: %s: %s", type(e).__name__, e,
                      extra={"user_id": user_id})
            raise HTTPException(502, "The assistant had trouble answering. Please try again.")

        by_id = {n["id"]: n for n in notes}
        citations = [
            Citation(
                id=cid,
                title=by_id[cid].get("title", ""),
                content_type=by_id[cid].get("content_type", ""),
                cover_image_url=by_id[cid].get("cover_image_url"),
                source_domain=by_id[cid].get("source_domain", ""),
            )
            for cid in dict.fromkeys(grounded.cited_note_ids)
            if cid in by_id
        ]
        return AskResponse(answer=grounded.answer_markdown, citations=citations)
    finally:
        await flush_usage(user_id, meter)
