"""One-off migration: prepare existing collections + notes for the smart-collections rework.

Delegations A/B built the new model — multi-membership `note.collection_ids` (the legacy scalar
`collection_id` kept coherent as a transition shim), and `collection.topic_query`/`topic_embedding`/
`pinned_note_ids`/`excluded_note_ids` computed by `services/collections.py`'s `rescore_collection`.
This script backfills EXISTING data onto that model so the first real rescore a user (or the
"Rescan" button) triggers is purely additive and never silently drops a note the user already
sees in a collection.

Per user, in order:
  (a) every note with a truthy scalar `collection_id` and no (or empty) `collection_ids` gets
      `collection_ids = [collection_id]` — lifts pre-migration single-home membership onto the
      new array field. The touched note is re-indexed into search_index so its bucket stays
      correct there too — but ONLY via `search_index.upsert_for_note` when the note already has
      a stored `embedding` (that path reuses the vector, no new embed call). A note with no
      stored embedding gets its search_index doc's `collection_id`/`collection_ids` patched
      directly instead (no embed, no doc creation) — routing it through `upsert_for_note` would
      fall back to a real, unpaced Vertex `embed_document` call per note, against a tiny QPM quota.
  (b) every collection gets its `topic_query`/`topic_embedding` computed via the SAME expand+embed
      code path `rescore_collection` uses — `services.collections._expand_topic_text` +
      `embedding_service.embed_query` — one embed call per collection, paced with a short sleep
      (the embedding QPM quota is tiny; see the embed-quota memory). Skipped entirely for a
      collection that already has a `topic_embedding` (rerun/resume safety — a rename after
      migration goes through a real rescore anyway, which always re-embeds). `pinned_note_ids`/
      `excluded_note_ids` are initialized to `[]` if absent. This does NOT run the reconciliation
      add/remove pass `rescore_collection` does — that's deliberate: pins are seeded in the next
      step, before anything is allowed to drop a note by cosine threshold.
  (c) `pinned_note_ids` is seeded with the collection's CURRENT members (by `collection_ids`
      array-contains, post step (a)) — so when the first real rescore runs, every note a user
      already sees in that collection is protected by a pin and can never be silently dropped by
      a cosine-threshold miss. New notes still get filed/removed normally by future rescores.

Idempotent: step (a) only touches notes that still lack `collection_ids`; step (b) recomputes
deterministically (safe to overwrite) but skips the embed call once a `topic_embedding` exists;
step (c) unions rather than duplicates existing pins.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.migrate_smart_collections --dry-run
    python -m scripts.migrate_smart_collections
"""
import argparse
import asyncio
import logging

from google.cloud.firestore_v1.vector import Vector

from services import search_index
from services.collections import _expand_topic_text
from services.embeddings import embedding_service
from services.firebase import get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.migrate_smart_collections")

EMBED_DELAY_S = 4.0  # ~15 embeds/min — text-embedding QPM quota is tiny


async def _sync_search_index_collection_fields(db, note_id: str, cid: str) -> None:
    """Best-effort: patch an existing search_index doc's collection fields directly — no embed,
    no doc creation. Used for notes with no stored embedding, where `upsert_for_note` would
    otherwise fall back to a real (unpaced) Vertex embed call. Skips silently if the index doc
    doesn't exist yet (a later backfill/ingest will create it with the right fields anyway)."""
    idx_ref = db.collection("search_index").document(f"note-{note_id}")
    try:
        snap = await idx_ref.get()
        if snap.exists:
            await idx_ref.update({"collection_id": cid, "collection_ids": [cid]})
    except Exception as e:  # noqa: BLE001 — index sync here is best-effort.
        log.warning("search_index collection sync failed for note %s: %s: %s",
                    note_id, type(e).__name__, e)


async def _lift_scalar_membership(db, dry_run: bool) -> int:
    """Step (a): every note with a truthy scalar `collection_id` and no/empty `collection_ids`
    gets `collection_ids = [collection_id]`. Re-indexes the touched note into search_index.
    Idempotent — a note that already has `collection_ids` is skipped."""
    lifted = 0
    async for doc in db.collection("notes").stream():
        d = doc.to_dict() or {}
        cid = d.get("collection_id")
        if not cid or d.get("collection_ids"):
            continue
        lifted += 1
        if dry_run:
            log.info("would lift note %s -> collection_ids=[%s]", doc.id, cid)
            continue
        await doc.reference.update({"collection_ids": [cid]})
        if d.get("embedding"):
            # Reuses the stored vector — upsert_for_note never re-embeds when given one.
            merged = {**d, "collection_ids": [cid]}
            await search_index.upsert_for_note(db, doc.id, merged, d.get("embedding"))
        else:
            # No stored embedding: don't let re-indexing trigger an unpaced Vertex embed call
            # against a tiny QPM quota. Just keep the existing index doc's collection fields
            # coherent instead.
            await _sync_search_index_collection_fields(db, doc.id, cid)
    return lifted


async def _current_members(db, uid: str, collection_id: str) -> list[str]:
    """Every note currently filed under this collection via the array field (post step (a),
    this also covers notes that only ever had the legacy scalar)."""
    ids: list[str] = []
    query = db.collection("notes").where("user_id", "==", uid).where(
        "collection_ids", "array_contains", collection_id)
    async for doc in query.stream():
        ids.append(doc.id)
    return ids


async def _process_collections(db, dry_run: bool) -> tuple[int, int, int]:
    """Steps (b) + (c): topic embedding + initialized override lists + pin-seeded members."""
    collections = embedded = pins_seeded = 0
    async for col in db.collection("collections").stream():
        collections += 1
        cid = col.id
        c = col.to_dict() or {}
        uid = c.get("user_id")
        name = c.get("name", "")
        description = c.get("description") or ""
        pinned = list(c.get("pinned_note_ids") or [])
        excluded = c.get("excluded_note_ids")

        # (b) Same expand+embed path as rescore_collection — no duplicated logic. Skipped
        # entirely when the collection already has a topic_embedding: rerunning the migration
        # (resume after a partial run, or a repeat invocation) must not re-embed every
        # collection every time — a rename after migration goes through a real rescore anyway,
        # which always re-embeds regardless.
        text = None
        qvec = None
        if not c.get("topic_embedding"):
            text = await _expand_topic_text(name, description)
            if text:
                try:
                    qvec = await embedding_service.embed_query(text)
                except Exception as e:  # noqa: BLE001 — best-effort, mirrors rescore_collection.
                    log.warning("embed failed for collection %s: %s: %s", cid, type(e).__name__, e)

        # (c) Seed pinned_note_ids with current members (union — idempotent on re-run).
        members = await _current_members(db, uid, cid) if uid else []
        new_pinned = sorted(set(pinned) | set(members))
        will_seed_pins = new_pinned != sorted(pinned)
        if will_seed_pins:
            pins_seeded += 1
        will_embed = bool(text and qvec)
        if will_embed:
            embedded += 1
        will_init_excluded = excluded is None

        if dry_run:
            log.info(
                "would update collection %s: topic_embed=%s pins_added=%d excluded_init=%s",
                cid, will_embed, len(set(members) - set(pinned)), will_init_excluded,
            )
            continue

        updates: dict = {}
        if will_embed:
            updates["topic_query"] = text
            updates["topic_embedding"] = Vector(qvec)
        if will_init_excluded:
            updates["excluded_note_ids"] = []
        if will_seed_pins:
            updates["pinned_note_ids"] = new_pinned
        if updates:
            await col.reference.update(updates)
        if will_embed:
            await asyncio.sleep(EMBED_DELAY_S)  # pace embeds — tiny QPM quota

    return collections, embedded, pins_seeded


async def run(dry_run: bool) -> None:
    db = get_db()
    lifted = await _lift_scalar_membership(db, dry_run)
    log.info("step (a): lifted %d note(s) onto collection_ids%s",
             lifted, " (dry-run)" if dry_run else "")

    collections, embedded, pins_seeded = await _process_collections(db, dry_run)
    log.info(
        "step (b)/(c): collections=%d topic_embedded=%d pins_seeded=%d%s",
        collections, embedded, pins_seeded, " (dry-run)" if dry_run else "",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes without writing")
    args = parser.parse_args()
    asyncio.run(run(args.dry_run))
