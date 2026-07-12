"""Reconcile mini-app item docs when a note's content_type changes.

A note fans out into per-family item docs (watch/place_items) gated on the content-family
predicates in services.gemini (is_entertainment / is_places). Those item docs carry
`source_note_ids` (which notes contributed them) but NOT the note's content_type, and the
frontend walls read the subcollections directly. So when the owner recategorizes a note, nothing
reconciles the items: a note wrongly saved as `movie` then fixed to `article` leaves its
watch_item visible in the Watchlist forever.

(The wishlist/recipes/trips mini-apps and their `wish_items`/`recipe_items`/`trip_items` families
were removed 2026-07-12 — the frontend dropped those walls, so fanning notes out into them was
pure wasted write cost. See CLAUDE.md "Current State" for the removal note.)

`reconcile_note_items` fixes that on PATCH /notes/{id}. It compares the family membership of the
OLD vs NEW content_type and, per family:
  - dropped (matched OLD, not NEW) → remove the note from that family's items (delete an item that
    had no other source note, otherwise just drop this note id from its source_note_ids);
  - gained (matches NEW, not OLD) → fan the note into that family, reusing the SAME per-note
    enrichers the ingest/backfill paths use (no new extraction logic).

Both directions are best-effort: any failure logs and is swallowed so the PATCH still succeeds —
the category change is the user's explicit intent; item sync is secondary. A same-family recategorise
(e.g. `movie` → `entertainment`, both entertainment) is a no-op: the note neither leaves nor joins.

`fan_out_note` is the ingest-time counterpart, called by the process worker after a note is
written: it runs the same forward fan-out for every family the note's content_type matches, so a
fresh capture appears in its mini-app immediately (and the WatchNote poster deep-links resolve).
At ingest the note's `data` already carries the structured, enriched payload (titles[] with TMDB
fields, venues[]), so the forward paths use it directly — no second Gemini extraction, no fresh
TMDB/Places API spend.
"""
import logging

from services import search_index
from services.firebase import get_db
from services.gemini import is_entertainment, is_places

log = logging.getLogger("clipnote.item_reconcile")


async def _forward_watch(uid: str, note_id: str, note: dict) -> None:
    from services import watchlist
    data = note.get("data") or {}
    # An entertainment-schema note already carries structured titles[] (with TMDB fields merged
    # in by enrich_note_data at ingest) — use them directly; enrich_titles reuses those fields
    # without re-querying TMDB. Gemini re-extraction is only for notes recategorised INTO the
    # family from a non-entertainment schema (no titles[]).
    titles = [t for t in data.get("titles") or []
              if isinstance(t, dict) and (t.get("title") or "").strip()]
    if not titles:
        from services.gemini import gemini_service
        titles = await gemini_service.extract_titles_from_note(
            note.get("title", ""), note.get("ai_summary", ""), data)
    if titles:
        await watchlist.enrich_titles(
            uid, note_id, titles, source_url=note.get("source_url"),
            source_domain=note.get("source_domain"))


async def _forward_place(uid: str, note_id: str, note: dict) -> None:
    from services import places
    from services.gemini import gemini_service
    data = note.get("data") or {}
    venues = data.get("venues")
    if not venues:
        venues = await gemini_service.extract_venues_from_note(
            note.get("title", ""), note.get("ai_summary", ""), data)
    if venues:
        await places.enrich_places(uid, note_id, venues)


# One row per content family: (predicate, item subcollection, search_index kind, forward fan-out).
# The predicate and forward enricher are the SAME ones ingest/backfill use, so reconciliation stays
# in lockstep with how items are created in the first place. Also imported by
# scripts/reconcile_stale_items.py (the one-off healer for items orphaned before this fix landed).
FAMILIES = (
    (is_entertainment, "watch_items", "watch", _forward_watch),
    (is_places, "place_items", "place", _forward_place),
)


async def fan_out_note(user_id: str, note_id: str, note: dict) -> None:
    """Fan a freshly written note out into every mini-app family its content_type matches.
    Called by the ingest worker after the note doc is written. Idempotent — every family enricher
    upserts on a stable doc id (tmdb id / canonical URL / place id) with ArrayUnion'd
    source_note_ids and never reseeds existing user state, so a Cloud Tasks retry re-running the
    fan-out converges on the same items. Best-effort per family: a failure logs and never fails
    the job (the note is already written)."""
    content_type = note.get("content_type") or ""
    for predicate, subcollection, _kind, forward in FAMILIES:
        try:
            if predicate(content_type):
                await forward(user_id, note_id, note)
        except Exception as e:  # noqa: BLE001 — fan-out must never sink an ingest.
            log.warning("item fan-out failed for note %s family %s: %s: %s",
                        note_id, subcollection, type(e).__name__, e)


async def _remove_note_from_family(db, user_id: str, note_id: str,
                                   subcollection: str, kind: str) -> None:
    """Drop `note_id` from every item in this family that references it. An item whose ONLY source
    was this note is deleted (and de-indexed); one with other sources just loses this note id."""
    coll = db.collection("users").document(user_id).collection(subcollection)
    async for snap in coll.where("source_note_ids", "array_contains", note_id).stream():
        item = snap.to_dict() or {}
        remaining = [s for s in (item.get("source_note_ids") or []) if s != note_id]
        ref = snap.reference
        if remaining:
            await ref.update({"source_note_ids": remaining})
        else:
            await ref.delete()
            await search_index.remove(db, kind, snap.id)


async def reconcile_note_items(user_id: str, note_id: str,
                               old_ct: str | None, new_ct: str | None) -> None:
    """Sync a note's mini-app item docs to a content_type change. Per family, best-effort: a
    failure in one family logs and never blocks the others or the PATCH. The note doc is fetched
    lazily (only when a forward fan-out actually needs it)."""
    db = get_db()
    old_ct = old_ct or ""
    new_ct = new_ct or ""
    note: dict | None = None
    for predicate, subcollection, kind, forward in FAMILIES:
        try:
            was, now = predicate(old_ct), predicate(new_ct)
            if was and not now:
                await _remove_note_from_family(db, user_id, note_id, subcollection, kind)
            elif now and not was:
                if note is None:
                    snap = await db.collection("notes").document(note_id).get()
                    note = snap.to_dict() or {}
                await forward(user_id, note_id, note)
        except Exception as e:  # noqa: BLE001 — item sync must never sink the category change.
            log.warning("item reconcile failed for note %s family %s: %s: %s",
                        note_id, subcollection, type(e).__name__, e)
