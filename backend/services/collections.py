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
    text = "\n".join(p for p in (name, description) if p).strip()
    if not text:
        return {"assigned": 0, "reason": "empty name/description"}
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
    async for doc in query.stream():
        d = doc.to_dict() or {}
        # Only sweep up notes that don't already belong to a bucket (single-home).
        if d.get("collection_id"):
            continue
        # COSINE distance = 1 - similarity; keep only close matches.
        dist = d.get("_distance")
        if dist is not None and dist > settings.COLLECTION_BACKFILL_MAX_DISTANCE:
            continue
        await doc.reference.update({"collection_id": collection_id})
        merged = {**d, "collection_id": collection_id}
        await search_index.upsert_for_note(db, doc.id, merged, d.get("embedding"))
        assigned += 1
    log.info("collection backfill for %s → %s: %d notes", user_id, collection_id, assigned)
    return {"assigned": assigned}
