"""Smart collections: assign existing notes into a user-named bucket.

New notes are filed at ingest by the classifier (services/gemini.py `classify` → `collection_id`).
But a collection created *today* should also sweep up matching notes saved *before* it existed.
This is that one-time backfill: embed the collection's name+description and pull the nearest
notes via the existing notes vector index, assigning only those currently unassigned (single-home
is preserved — a note already in another bucket is never moved).

Cheap by design: one query embed + one vector query, no per-note LLM call. It's approximate — a
cosine threshold trades recall for precision — so it's best-effort and re-runnable.
"""
import logging

from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from services import search_index
from services.embeddings import embedding_service

log = logging.getLogger("clipnote.collections")


async def assign_unassigned_to_collection(db, user_id: str, collection_id: str,
                                          name: str, description: str = "") -> dict:
    """Assign this user's currently-unassigned notes that match `name`/`description` into the
    collection. Returns a small summary. Best-effort; never raises for a matching miss."""
    # Dedupe: the creation UI historically copied the name into the description, so "AI\nAI"
    # was the whole query. Collapse identical parts before judging how thin the text is.
    parts = [p.strip() for p in (name, description) if p and p.strip()]
    if len(parts) == 2 and parts[0].lower() == parts[1].lower():
        parts = parts[:1]
    text = "\n".join(parts)
    if not text:
        return {"assigned": 0, "reason": "empty name/description"}
    # A short name/description embeds too thin to clear the cosine threshold ("AI" matches
    # nothing at ≤0.45). Expand it into a real semantic query first — best-effort, one lite call.
    if len(text) < settings.COLLECTION_QUERY_EXPAND_BELOW:
        from services.gemini import gemini_service  # late import: avoid module-load cycle
        expanded = await gemini_service.expand_collection_query(name, description)
        if expanded:
            text = f"{text}\n{expanded}"
    try:
        qvec = await embedding_service.embed_query(text)
    except Exception as e:  # noqa: BLE001
        log.warning("collection backfill embed failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": user_id})
        return {"assigned": 0, "reason": "embed failed"}
    if not qvec:
        return {"assigned": 0, "reason": "no embedding"}

    query = db.collection("notes").where("user_id", "==", user_id).find_nearest(
        vector_field="embedding",
        query_vector=Vector(qvec),
        distance_measure=DistanceMeasure.COSINE,
        limit=settings.COLLECTION_BACKFILL_K,
        distance_result_field="_distance",
    )
    assigned = 0
    already_filed = 0  # matched, but living in another bucket (single-home) — surfaced to the UI
    async for doc in query.stream():
        d = doc.to_dict() or {}
        # COSINE distance = 1 - similarity; keep only close matches.
        dist = d.get("_distance")
        if dist is not None and dist > settings.COLLECTION_BACKFILL_MAX_DISTANCE:
            continue
        # Only sweep up notes that don't already belong to a bucket (single-home).
        if d.get("collection_id"):
            already_filed += 1
            continue
        await doc.reference.update({"collection_id": collection_id})
        merged = {**d, "collection_id": collection_id}
        await search_index.upsert_for_note(db, doc.id, merged, d.get("embedding"))
        assigned += 1
    log.info("collection backfill for %s → %s: %d notes (%d matched but already filed)",
             user_id, collection_id, assigned, already_filed)
    return {"assigned": assigned, "already_filed": already_filed}
