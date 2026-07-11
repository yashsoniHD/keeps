"""One-off backfill: normalize place-venue city strings to one canonical spelling.

Bug: the Places mini-app showed "Bangalore" and "Bengaluru" as two separate city filter chips for
what is really one city — a venue's `city` field was whatever raw text a source caption (or an
older Places lookup) produced, and nothing collapsed known variants. `services/enrich.py` now
fixes this at WRITE time (`normalize_city`/`CITY_ALIASES`: prefer a fresh Google Places `locality`
over source text; a small alias map — Bangalore->Bengaluru, Bombay->Mumbai, Madras->Chennai,
Calcutta->Kolkata, Gurgaon->Gurugram — covers the case where only source text is available). This
script re-normalizes what's ALREADY stored, importing that SAME alias map (never duplicated) —
no new Places API calls, so it's free and safe to re-run.

Two places carry a venue `city` (see CLAUDE.md's Places section) and both are covered here:
  - notes.data.venues[].city — rendered by PlaceNote.tsx in the note detail view.
  - users/{uid}/place_items/{id}.city — the field the Places-wall city filter CHIPS actually read
    (frontend/src/components/places/PlacesView.tsx: `i.city`); written by services/places.py, a
    separate path from the note-embedded venues above (mini-app items are populated by the
    "Import from notes" backfill and by manually adding a place, so they need their own pass —
    normalizing only notes.data.venues would leave the actual chips unfixed).

Idempotent: a city already in canonical form is left untouched, so re-running does no work.

Usage (from backend/, with ADC pointing at the project):
    python -m scripts.normalize_cities                # dry-run (default)
    python -m scripts.normalize_cities --apply
    python -m scripts.normalize_cities --apply --uid UID
"""
import argparse
import asyncio
import logging
from datetime import datetime, timezone

from services.enrich import normalize_city
from services.firebase import get_db
from services.gemini import is_places

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("clipnote.normalize_cities")


def normalize_venues(venues: list) -> tuple[list, int]:
    """Re-normalize each venue's `city` field. Returns (new venues list, count actually changed).
    Pure — no I/O — so it's unit-testable without Firestore."""
    changed = 0
    out = []
    for v in venues:
        if not isinstance(v, dict):
            out.append(v)
            continue
        raw = v.get("city")
        norm = normalize_city(raw)
        if norm and norm != raw:
            v = {**v, "city": norm}
            changed += 1
        out.append(v)
    return out, changed


async def _fix_notes(db, dry_run: bool, uid: str | None) -> tuple[int, int, int]:
    """Normalize notes.data.venues[].city on every place note. Returns
    (place-notes-with-venues-scanned, notes-changed, venues-normalized)."""
    scanned = notes_changed = venues_changed = 0
    query = db.collection("notes")
    if uid:
        query = query.where("user_id", "==", uid)

    async for doc in query.stream():
        note = doc.to_dict() or {}
        if not is_places(note.get("content_type", "")):
            continue
        venues = (note.get("data") or {}).get("venues")
        if not isinstance(venues, list) or not venues:
            continue
        scanned += 1
        new_venues, changed = normalize_venues(venues)
        if not changed:
            continue
        notes_changed += 1
        venues_changed += changed
        log.info("note %s (user=%s): %d venue city field(s) normalized",
                 doc.id, note.get("user_id"), changed)
        if dry_run:
            continue
        data = dict(note.get("data") or {})
        data["venues"] = new_venues
        await doc.reference.set(
            {"data": data, "updated_at": datetime.now(timezone.utc)}, merge=True)

    return scanned, notes_changed, venues_changed


async def _fix_place_items(db, dry_run: bool, uid: str | None) -> tuple[int, int]:
    """Normalize the Places-wall place_items' own `city` field (what the frontend chips read)."""
    scanned = changed = 0
    stream = (
        db.collection("users").document(uid).collection("place_items").stream()
        if uid else db.collection_group("place_items").stream()
    )
    async for doc in stream:
        scanned += 1
        item = doc.to_dict() or {}
        raw = item.get("city")
        norm = normalize_city(raw)
        if not norm or norm == raw:
            continue
        changed += 1
        log.info("place_item %s (user=%s): city %r -> %r",
                 doc.id, item.get("user_id"), raw, norm)
        if dry_run:
            continue
        await doc.reference.set({"city": norm}, merge=True)

    return scanned, changed


async def run(dry_run: bool, uid: str | None) -> None:
    db = get_db()
    n_scanned, n_notes, n_venues = await _fix_notes(db, dry_run, uid)
    i_scanned, i_changed = await _fix_place_items(db, dry_run, uid)
    log.info(
        "done: place-notes scanned=%d notes-changed=%d venues-normalized=%d | "
        "place_items scanned=%d normalized=%d%s",
        n_scanned, n_notes, n_venues, i_scanned, i_changed, " (dry-run)" if dry_run else "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="write changes (default is dry-run: log matches, write nothing)")
    parser.add_argument("--uid", help="only normalize one user")
    args = parser.parse_args()
    asyncio.run(run(dry_run=not args.apply, uid=args.uid))
