"""Smart collections: hybrid multi-membership between a user's notes and their named buckets.

Each collection stores a `topic_embedding` (Vertex text embedding of its name/description,
expanded via `expand_collection_query` when thin — see `gemini.py`). A note belongs to a
collection when cosine_similarity(note.embedding, collection.topic_embedding) clears the
collection's `match_threshold` (or the global `COLLECTION_MATCH_MIN_SIMILARITY` default) —
so a note can now belong to more than one collection, unlike the old single-home
`collection_id` classifier assignment.

`pinned_note_ids` / `excluded_note_ids` on the collection are hard overrides that survive
re-scoring: a pinned note is always in, however far its embedding drifts; an excluded note is
always out, however close a match it becomes.

`rescore_collection` is the operation that (re)computes membership for one collection against
a user's whole corpus — on creation (sweeping pre-existing notes, what used to be called
"backfill"), and again whenever the collection's name/description or overrides change. It's
cheap by design (one query embed + one vector query), approximate (a cosine threshold trades
recall for precision), and idempotent/re-runnable.
"""
import logging

from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from services import search_index
from services.embeddings import embedding_service

log = logging.getLogger("clipnote.collections")


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Pure-Python cosine similarity (no numpy dependency — not in requirements.txt).
    Returns 0.0 for empty/mismatched/zero vectors rather than raising."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def match_collections_by_embedding(note_vec: list[float] | None, note_id: str,
                                   collections: list[dict]) -> list[str]:
    """Pure function: which of this user's collections a note belongs to, by cosine similarity
    between `note_vec` and each collection's `topic_embedding`.

    Precedence per collection (checked in order — exclusion always wins):
    1. `excluded_note_ids` contains note_id → never matches, regardless of similarity or pin.
    2. `pinned_note_ids` contains note_id → always matches, regardless of similarity/threshold
       (and even if the collection has no `topic_embedding` yet, or `note_vec` is None — a note
       whose embedding hasn't been computed yet must still get its pin honored).
    3. Otherwise: skip collections with no `topic_embedding`; match when
       cosine_similarity(note_vec, topic_embedding) >= (collection's `match_threshold` or
       `settings.COLLECTION_MATCH_MIN_SIMILARITY`). `note_vec=None` safely never matches here
       (`_cosine_similarity` returns 0.0 for a falsy vector) — only the pin path above can match
       a note with no embedding.
    """
    matched: list[str] = []
    for c in collections:
        cid = c.get("id")
        if not cid:
            continue
        if note_id in (c.get("excluded_note_ids") or []):
            continue
        if note_id in (c.get("pinned_note_ids") or []):
            matched.append(cid)
            continue
        topic_vec = c.get("topic_embedding")
        if not topic_vec:
            continue
        threshold = c.get("match_threshold")
        if threshold is None:
            threshold = settings.COLLECTION_MATCH_MIN_SIMILARITY
        if _cosine_similarity(note_vec, list(topic_vec)) >= threshold:
            matched.append(cid)
    return matched


async def _expand_topic_text(name: str, description: str = "") -> str | None:
    """Build the text to embed for a collection's topic: dedupe name/description, and expand
    a too-thin name+description into a real semantic query via one lite Gemini call (best-effort).
    Returns None when there's nothing to embed."""
    # Dedupe: the creation UI historically copied the name into the description, so "AI\nAI"
    # was the whole query. Collapse identical parts before judging how thin the text is.
    parts = [p.strip() for p in (name, description) if p and p.strip()]
    if len(parts) == 2 and parts[0].lower() == parts[1].lower():
        parts = parts[:1]
    text = "\n".join(parts)
    if not text:
        return None
    # A short name/description embeds too thin to clear the cosine threshold ("AI" matches
    # nothing at ≤0.45). Expand it into a real semantic query first — best-effort, one lite call.
    if len(text) < settings.COLLECTION_QUERY_EXPAND_BELOW:
        from services.gemini import gemini_service  # late import: avoid module-load cycle
        expanded = await gemini_service.expand_collection_query(name, description)
        if expanded:
            text = f"{text}\n{expanded}"
    return text


def _current_collection_ids(note_data: dict) -> list[str]:
    """A note's current membership list — `collection_ids` if present, else lifted from the
    legacy scalar `collection_id` (pre-migration notes only ever have the scalar)."""
    ids = note_data.get("collection_ids")
    if ids:
        return list(ids)
    legacy = note_data.get("collection_id")
    return [legacy] if legacy else []


async def _apply_membership(db, note_id: str, collection_id: str, add: bool) -> dict | None:
    """Atomically add/remove ONE collection id from a note's membership.

    Reads the note fresh *inside* a per-note Firestore transaction and recomputes the array from
    that current value plus this operation's add/remove of this collection id only — not from a
    `new_ids` list computed off an earlier read. That earlier design let two concurrent callers
    touching the same note (e.g. two rescores on different collections, or a rescore racing a
    pin) stomp each other's write: both would read the same starting array, each append/remove
    their own id, and whichever `update()` landed second would overwrite the first's change.
    Keeping the read+recompute+write inside one transaction closes that race. Keeps the scalar
    `collection_id` coherent (first element, or null) in the same transaction.

    Returns the merged post-write note dict so the caller can mirror it into search_index — that
    mirror stays outside the transaction (best-effort, same as before the fix). Returns None if
    the note no longer exists (e.g. deleted between the candidate scan and this call)."""
    from google.cloud import firestore as fs

    note_ref = db.collection("notes").document(note_id)

    @fs.async_transactional
    async def _update(tx) -> dict | None:
        snap = await note_ref.get(transaction=tx)
        if not snap.exists:
            return None
        note_data = snap.to_dict() or {}
        cur_ids = _current_collection_ids(note_data)
        if add:
            new_ids = cur_ids if collection_id in cur_ids else [*cur_ids, collection_id]
        else:
            new_ids = [cid for cid in cur_ids if cid != collection_id]
        new_scalar = new_ids[0] if new_ids else None
        tx.set(note_ref, {"collection_ids": new_ids, "collection_id": new_scalar}, merge=True)
        return {**note_data, "collection_ids": new_ids, "collection_id": new_scalar}

    merged = await _update(db.transaction())
    if merged is not None:
        await search_index.upsert_for_note(db, note_id, merged, merged.get("embedding"))
    return merged


async def add_pin(db, collection_id: str, note_id: str) -> None:
    """Pin: manually add a note to a collection. A pin is a hard override that survives
    rescoring — the note stays in even if a later cosine sweep says it doesn't match (see
    `match_collections_by_embedding`). Symmetric with `add_exclusion`: pinning a note also clears
    any prior exclusion of it on this same collection (the two are mutually exclusive intents).
    Updates both sides: the collection's own override lists, and the note's `collection_ids`
    (+ scalar coherence + search_index mirror, atomically via `_apply_membership`)."""
    c_ref = db.collection("collections").document(collection_id)
    c_snap = await c_ref.get()
    c = c_snap.to_dict() or {}
    pinned = list(c.get("pinned_note_ids") or [])
    excluded = list(c.get("excluded_note_ids") or [])
    if note_id not in pinned:
        pinned.append(note_id)
    if note_id in excluded:
        excluded.remove(note_id)
    await c_ref.update({"pinned_note_ids": pinned, "excluded_note_ids": excluded})
    await _apply_membership(db, note_id, collection_id, add=True)


async def add_exclusion(db, collection_id: str, note_id: str) -> None:
    """Manual remove: exclude a note from a collection. An exclusion is a hard override that
    survives rescoring — the note stays out even if it becomes a strong match again (see
    `match_collections_by_embedding`). Symmetric with `add_pin`: excluding a note also clears
    any prior pin of it on this same collection. Updates both sides, mirroring `add_pin`."""
    c_ref = db.collection("collections").document(collection_id)
    c_snap = await c_ref.get()
    c = c_snap.to_dict() or {}
    pinned = list(c.get("pinned_note_ids") or [])
    excluded = list(c.get("excluded_note_ids") or [])
    if note_id not in excluded:
        excluded.append(note_id)
    if note_id in pinned:
        pinned.remove(note_id)
    await c_ref.update({"pinned_note_ids": pinned, "excluded_note_ids": excluded})
    await _apply_membership(db, note_id, collection_id, add=False)


async def strip_collection_from_notes(db, uid: str, collection_id: str) -> int:
    """Best-effort sweep for a deleted collection: remove `collection_id` from every member
    note's `collection_ids` (+ scalar coherence + search_index mirror, atomically via
    `_apply_membership`). A failure on one note must not block the rest. Returns the count of
    notes stripped."""
    query = (db.collection("notes").where("user_id", "==", uid)
             .where("collection_ids", "array_contains", collection_id))
    stripped = 0
    async for doc in query.stream():
        try:
            await _apply_membership(db, doc.id, collection_id, add=False)
            stripped += 1
        except Exception as e:  # noqa: BLE001 — best-effort sweep, one failure must not block the rest.
            log.warning("collection delete sweep failed for note %s: %s: %s",
                        doc.id, type(e).__name__, e)
    return stripped


async def rescore_collection(db, uid: str, collection_id: str,
                             name: str | None = None, description: str | None = None,
                             collection_data: dict | None = None) -> dict:
    """(Re)compute this collection's membership across the user's whole corpus.

    1. Loads the collection doc (name/description default to the doc's own fields when not
       passed explicitly — callers that already have them, e.g. the router, can skip a read).
       `collection_data` lets a caller that has *already read the doc* for its own purposes
       (the router's owner-check) pass that dict straight through instead of a second read.
    2. Expands a thin name/description into a real query (best-effort, one lite call).
    3. Embeds the topic text (RETRIEVAL_QUERY — asymmetric with the RETRIEVAL_DOCUMENT note
       embeddings, matching the existing search convention).
    4. Persists `topic_query`/`topic_embedding` onto the collection doc.
    5. Finds the nearest notes via the vector index (K = COLLECTION_BACKFILL_K), plus any pinned
       notes outside that shortlist, any notes currently carrying this collection in the
       `collection_ids` array, and any notes carrying it only via the legacy scalar
       `collection_id` (pre-migration notes never gained the array field, so the array query
       alone can't see them) — so drift can be detected and removed, not just new matches added.
    6. Reconciles: adds matches that aren't already filed, removes stale non-pinned matches,
       never removes pinned notes, never adds excluded notes. A candidate with no embedding yet
       (fresh capture, or an embed failure) is left untouched UNLESS it's pinned — a pin decides
       before the matcher ever looks at the vector, so a pinned-but-not-yet-embedded note must
       still get filed.

    Returns {"matched", "added", "removed"} — best-effort throughout; a miss (empty text, embed
    failure) returns zero counts with a "reason" instead of raising.
    """
    c_ref = db.collection("collections").document(collection_id)
    if collection_data is None:
        snap = await c_ref.get()
        if not snap.exists:
            return {"matched": 0, "added": 0, "removed": 0, "reason": "collection not found"}
        c = snap.to_dict() or {}
    else:
        c = collection_data
    name = c.get("name", "") if name is None else name
    description = (c.get("description") or "") if description is None else description
    pinned_ids: list[str] = c.get("pinned_note_ids") or []
    excluded_ids: list[str] = c.get("excluded_note_ids") or []
    match_threshold = c.get("match_threshold")

    text = await _expand_topic_text(name, description)
    if not text:
        return {"matched": 0, "added": 0, "removed": 0, "reason": "empty name/description"}
    try:
        qvec = await embedding_service.embed_query(text)
    except Exception as e:  # noqa: BLE001
        log.warning("collection rescore embed failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": uid})
        return {"matched": 0, "added": 0, "removed": 0, "reason": "embed failed"}
    if not qvec:
        return {"matched": 0, "added": 0, "removed": 0, "reason": "no embedding"}

    await c_ref.update({"topic_query": text, "topic_embedding": Vector(qvec)})

    # 1. Nearest-K candidates via the vector index — cheap recall bound over the whole corpus.
    query = db.collection("notes").where("user_id", "==", uid).find_nearest(
        vector_field="embedding",
        query_vector=Vector(qvec),
        distance_measure=DistanceMeasure.COSINE,
        limit=settings.COLLECTION_BACKFILL_K,
    )
    candidates: dict[str, dict] = {}
    async for doc in query.stream():
        candidates[doc.id] = doc.to_dict() or {}

    # 2. Pinned notes must be considered even if they fell outside the nearest-K shortlist.
    for note_id in pinned_ids:
        if note_id in candidates:
            continue
        nsnap = await db.collection("notes").document(note_id).get()
        if nsnap.exists:
            nd = nsnap.to_dict() or {}
            if nd.get("user_id") == uid:
                candidates[note_id] = nd

    # 3. Notes currently filed under this collection must also be considered, so a note whose
    #    embedding drifted away (rename/description change) and out of the nearest-K gets removed.
    tagged_query = db.collection("notes").where("user_id", "==", uid) \
        .where("collection_ids", "array_contains", collection_id)
    async for doc in tagged_query.stream():
        if doc.id not in candidates:
            candidates[doc.id] = doc.to_dict() or {}

    # 3b. Notes tagged only via the legacy scalar `collection_id` (the pre-migration ingest
    #     path never writes the `collection_ids` array) are invisible to the array_contains
    #     query above — a second, scalar-field query catches them so they aren't stuck outside
    #     reconciliation until they happen to land in the nearest-K shortlist. Covered by the
    #     existing (user_id, collection_id, created_at) composite index.
    legacy_query = db.collection("notes").where("user_id", "==", uid) \
        .where("collection_id", "==", collection_id)
    async for doc in legacy_query.stream():
        if doc.id not in candidates:
            candidates[doc.id] = doc.to_dict() or {}

    collection_for_match = {
        "id": collection_id,
        "topic_embedding": qvec,
        "pinned_note_ids": pinned_ids,
        "excluded_note_ids": excluded_ids,
        "match_threshold": match_threshold,
    }

    matched_ids: set[str] = set()
    added = 0
    removed = 0
    for note_id, note_data in candidates.items():
        embedding = note_data.get("embedding")
        is_pinned = note_id in pinned_ids
        if embedding is None and not is_pinned:
            # Can't evaluate a note with no embedding yet against the cosine threshold, and no
            # pin/exclude override applies — leave it untouched, same as before. A PINNED note
            # must still flow through the matcher below: `match_collections_by_embedding` checks
            # the pin before it ever touches the vector, so a fresh capture (or an embed failure)
            # that's already pinned still needs to be filed.
            continue
        note_vec = list(embedding) if embedding is not None else None
        is_match = collection_id in match_collections_by_embedding(
            note_vec, note_id, [collection_for_match])
        cur_ids = _current_collection_ids(note_data)
        already_has = collection_id in cur_ids

        if is_match:
            matched_ids.add(note_id)
            if not already_has:
                await _apply_membership(db, note_id, collection_id, add=True)
                added += 1
        elif already_has:
            if is_pinned:
                # Hard override: a pinned note is never removed, even if excluded/out-of-range
                # data made the matcher say no (e.g. a contradictory pin+exclude edit).
                matched_ids.add(note_id)
                continue
            await _apply_membership(db, note_id, collection_id, add=False)
            removed += 1

    log.info("collection rescore for %s → %s: %d matched (%d added, %d removed)",
             uid, collection_id, len(matched_ids), added, removed)
    return {"matched": len(matched_ids), "added": added, "removed": removed}
