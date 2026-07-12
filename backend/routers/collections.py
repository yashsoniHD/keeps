"""Smart-collection endpoints.

Collections are created + styled directly by the client (Firestore rules allow owner writes to
`collections/{id}` for name/description/icon/palette/updated_at — see infra/firestore.rules).
The backend owns everything that touches NOTE membership, because notes are backend-write-only:

- `POST .../rescore`: (re)compute embedding-matched membership across the user's whole corpus.
  Rate-capped per collection per day (MAX_RESCORES_PER_COLLECTION_PER_DAY) and gated by
  MAX_COLLECTIONS_PER_USER — collections are client-created directly in Firestore, so this
  endpoint is the one enforcement boundary for both caps.
- `POST/DELETE .../notes/{note_id}`: pin/exclude — hard overrides that survive rescoring.
- `DELETE /collections/{id}`: strips the collection id from every member note (best-effort sweep)
  before deleting the collection doc. The client's own `deleteCollection()` (a bare Firestore
  `deleteDoc`) does NOT do this sweep — the frontend calls this endpoint first and only falls
  back to the bare client delete if the request fails, so the folder still goes away either way.
- `POST .../digest`: return (rebuilding when stale/forced) the collection's cached, composed
  digest — an intro + optional facts + categorized sections of entries deep-linking to their
  source notes, built by Gemini from the member notes (services/gemini.py `build_digest`).
  Cached on the collection doc (`digest`), keyed by a signature of the member note ids so an
  unchanged collection never re-triggers a paid rebuild. Rate-capped like rescore
  (MAX_DIGEST_REGENS_PER_COLLECTION_PER_DAY / _PER_USER_PER_DAY / DAILY_GLOBAL_DIGEST_CAP).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import settings
from services.auth_dep import require_user
from services.collections import (
    add_exclusion,
    add_pin,
    rescore_collection,
    strip_collection_from_notes,
)
from services.firebase import (
    flush_usage,
    get_db,
    get_user_collections,
    reserve_collection_digest,
    reserve_collection_rescore,
)
from services.gemini import gemini_service
from services.usage_meter import start_metering

router = APIRouter(tags=["collections"])


class DigestRequest(BaseModel):
    force: bool = False


async def _owned_collection(db, collection_id: str, user_id: str) -> dict:
    """Resolve a collection the caller owns, or 404 (never reveal another user's id exists)."""
    snap = await db.collection("collections").document(collection_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("user_id") != user_id:
        raise HTTPException(404, "Collection not found")
    return d


async def _owned_note(db, note_id: str, user_id: str) -> dict:
    """Resolve a note the caller owns, or 404."""
    snap = await db.collection("notes").document(note_id).get()
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    return d


async def _rescore(collection_id: str, user_id: str) -> dict:
    """Shared handler behind /rescore."""
    db = get_db()
    d = await _owned_collection(db, collection_id, user_id)
    # Collections are created directly by the client in Firestore (no backend create path), so
    # this API call is the one enforcement boundary for the cap on how many a user can have.
    collections = await get_user_collections(user_id)
    if len(collections) > settings.MAX_COLLECTIONS_PER_USER:
        raise HTTPException(
            400, f"You have more than {settings.MAX_COLLECTIONS_PER_USER} collections — "
                 "delete some before rescoring.")
    if not await reserve_collection_rescore(user_id, collection_id):
        raise HTTPException(
            429, "Rescore limit reached for this collection today — try again tomorrow.")
    return await rescore_collection(
        db, user_id, collection_id, d.get("name", ""), d.get("description") or "",
        collection_data=d)


@router.post("/collections/{collection_id}/rescore")
async def rescore(collection_id: str, user_id: str = Depends(require_user)):
    """(Re)score this collection's membership across the user's whole corpus — matches by
    embedding similarity, respecting pinned/excluded overrides. Owner-checked; capped
    (MAX_RESCORES_PER_COLLECTION_PER_DAY) and gated by MAX_COLLECTIONS_PER_USER. Idempotent."""
    return await _rescore(collection_id, user_id)


@router.post("/collections/{collection_id}/notes/{note_id}")
async def pin_note(collection_id: str, note_id: str, user_id: str = Depends(require_user)):
    """Pin: manually add a note to a collection, overriding the embedding matcher — it stays in
    even if a later rescore's cosine similarity says otherwise. Owner-checked on both docs."""
    db = get_db()
    await _owned_collection(db, collection_id, user_id)
    await _owned_note(db, note_id, user_id)
    await add_pin(db, collection_id, note_id)
    return {"ok": True}


@router.delete("/collections/{collection_id}/notes/{note_id}")
async def exclude_note(collection_id: str, note_id: str, user_id: str = Depends(require_user)):
    """Manual remove: exclude a note from a collection, overriding the embedding matcher — it
    stays out even if it becomes a strong match again on a later rescore. Owner-checked."""
    db = get_db()
    await _owned_collection(db, collection_id, user_id)
    await _owned_note(db, note_id, user_id)
    await add_exclusion(db, collection_id, note_id)
    return {"ok": True}


@router.delete("/collections/{collection_id}")
async def delete_collection(collection_id: str, user_id: str = Depends(require_user)):
    """Delete sweep: strip this collection id from every member note's `collection_ids` (best-
    effort, batched-by-stream) before deleting the collection doc itself. Owner-checked."""
    db = get_db()
    await _owned_collection(db, collection_id, user_id)
    stripped = await strip_collection_from_notes(db, user_id, collection_id)
    await db.collection("collections").document(collection_id).delete()
    return {"ok": True, "stripped": stripped}


# ──────────────────────────── digest ────────────────────────────

async def _member_notes(db, user_id: str, collection_id: str) -> tuple[list[dict], int]:
    """This collection's member notes (newest first, capped at DIGEST_MAX_NOTES — the fed set
    the digest is built from) plus the TOTAL member count (so the endpoint can report coverage
    when the cap truncates).

    Membership is the union of the `collection_ids` array_contains query and the legacy scalar
    `collection_id ==` query — unmigrated notes carry only the scalar field and are invisible to
    array_contains (mirrors the reconciliation pattern in services/collections.py rescore_collection,
    see its "3b." comment). We dedupe by id, then apply newest-first ordering and the cap to the
    merged set so the fed set (and its signature) reflect true membership, not just one tagging path.
    """
    array_query = (
        db.collection("notes").where("user_id", "==", user_id)
        .where("collection_ids", "array_contains", collection_id)
    )
    legacy_query = (
        db.collection("notes").where("user_id", "==", user_id)
        .where("collection_id", "==", collection_id)
    )
    by_id: dict[str, dict] = {}
    for query in (array_query, legacy_query):
        async for doc in query.stream():
            if doc.id in by_id:
                continue
            d = doc.to_dict() or {}
            d["id"] = doc.id
            by_id[doc.id] = d

    total = len(by_id)

    def _created_at_key(note: dict):
        created_at = note.get("created_at")
        # Sort missing timestamps last instead of erroring on a None/other comparison.
        return created_at is not None, created_at

    ordered = sorted(by_id.values(), key=_created_at_key, reverse=True)
    notes = ordered[: settings.DIGEST_MAX_NOTES]
    return notes, total


@router.post("/collections/{collection_id}/digest")
async def digest(collection_id: str, body: DigestRequest | None = None,
                 user_id: str = Depends(require_user)):
    """Return this collection's digest, rebuilding it when membership has changed since the
    last build, when the cached digest predates the current DIGEST_PROMPT_VERSION, or when
    `force` is set. Owner-checked.

    Response contract: `{"digest": <CollectionDigest dict> | None, "stale": bool}`.
    - An empty collection (no member notes) returns `{"digest": None}` — no Gemini call.
    - A signature match (same member note ids as the last build, same or newer
      `prompt_version`, not forced) returns the cached digest with `"stale": False` — no
      reserve, no Gemini call. A digest with a missing/older `prompt_version` is rebuilt even
      when membership is unchanged, so prompt improvements reach existing digests automatically.
    - When today's rebuild budget is exhausted (MAX_DIGEST_REGENS_PER_COLLECTION_PER_DAY /
      _PER_USER_PER_DAY / DAILY_GLOBAL_DIGEST_CAP) or the model call fails, the existing cached
      digest (possibly None, if there never was one) is returned with `"stale": True` — a
      digest miss never 500s and never blocks the collection view.
    - Otherwise a fresh digest is built, cached onto `collections/{id}.digest` (merge — does
      NOT touch `updated_at`, which the library grid orders by), and returned with
      `"stale": False`.
    """
    body = body or DigestRequest()
    db = get_db()
    d = await _owned_collection(db, collection_id, user_id)

    notes, total = await _member_notes(db, user_id, collection_id)
    if not notes:
        return {"digest": None}

    member_ids = sorted(n["id"] for n in notes)
    stored = d.get("digest") or {}
    same_membership = sorted(stored.get("source_note_ids") or []) == member_ids
    # A digest built under an older (or unversioned) prompt is treated as stale even when
    # membership hasn't changed, so existing digests pick up prompt improvements automatically
    # on their next view instead of staying stuck on the old output forever.
    current_prompt = stored.get("prompt_version")
    prompt_current = current_prompt is not None and current_prompt >= settings.DIGEST_PROMPT_VERSION
    if not body.force and same_membership and prompt_current:
        return {"digest": stored, "stale": False}

    if not await reserve_collection_digest(user_id, collection_id):
        return {"digest": stored or None, "stale": True}

    meter = start_metering()
    try:
        built = await gemini_service.build_digest(
            d.get("name", ""), d.get("description") or "", notes)
    finally:
        await flush_usage(user_id, meter)

    if built is None:
        return {"digest": stored or None, "stale": True}

    coverage = (
        f"Digest built from {len(notes)} of {total} notes." if total > len(notes) else None
    )
    digest_map = {
        "intro": built.intro,
        "facts": [f.model_dump() for f in built.facts],
        "sections": [s.model_dump() for s in built.sections],
        "coverage": coverage,
        "source_note_ids": member_ids,
        "generated_at": datetime.now(timezone.utc),
        "model": settings.GEMINI_MODEL,
        "prompt_version": settings.DIGEST_PROMPT_VERSION,
    }
    # merge=True writes only the `digest` key — sibling top-level fields (notably `updated_at`,
    # which the library grid orders by) are left untouched.
    await db.collection("collections").document(collection_id).set(
        {"digest": digest_map}, merge=True)
    return {"digest": digest_map, "stale": False}
