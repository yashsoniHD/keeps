"""Trips mini-app: fan itinerary notes out into per-trip trip_items.

The travel counterpart of services/recipes.py. An itinerary note arrives *already structured* by
Gemini: the `itinerary` TYPE_PROMPT puts the destination, duration, budget, best season, day-by-day
stops and tips in the note's `data`, the trip name is the note `title`, and its photo is the note
`cover_image_url`. So fan-out is largely a 1:1 copy into one trackable doc under users/{uid}/
trip_items, deduped by the canonical trip URL across notes (the same trip saved twice = one item)
and carrying its own user state (`favorite`) which a re-save must never reset.

The one enrichment beyond a pure copy: itinerary stops carry no coordinates, so to drive the detail
map we geocode each stop by name via the existing Google Places Text Search (cached, ADC auth, a
graceful no-op when ENABLE_PLACES is off). Stops that don't resolve are simply absent from the map;
the timeline still lists them. Geocoding is capped per trip (TRIP_MAX_GEOCODED_STOPS) to bound cost.

Like the recipes app, trips have no status workflow — they're a single wall organised by filters +
favorites — so the only owner-editable field is `favorite`.

Fan-out is 1:1 — one itinerary note → one trip_item.
"""
import hashlib
import logging
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from google.cloud.firestore_v1 import ArrayUnion

from config import settings
from services import google_places, search_index
from services.firebase import get_db
from services.watchlist import get_user_region  # shared region resolver (users/{uid}.region)

log = logging.getLogger("clipnote.itineraries")

# Query params that never identify a trip — strip them so the same trip linked with different
# tracking junk dedupes to one item. Anything else (a real ?id=) is kept.
_TRACKING_PARAMS = re.compile(r"^(utm_|ref$|ref_|tag$|fbclid$|gclid$|mc_|_branch|spm$|igsh$)", re.I)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "untitled"


def _canonical_url(url: str) -> str | None:
    """Normalize a trip URL for stable dedup: lowercase scheme+host, drop the fragment and any
    tracking-only query params, keep the rest sorted. None if there's nothing url-like."""
    if not url or not isinstance(url, str):
        return None
    try:
        parts = urlsplit(url.strip())
        if not parts.netloc:
            return None
        kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
                if not _TRACKING_PARAMS.match(k)]
        query = urlencode(sorted(kept))
        path = parts.path.rstrip("/") or "/"
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))
    except Exception:  # noqa: BLE001 — a malformed URL just means "no canonical key".
        return None


def _doc_id(canonical_url: str | None, destination: str, title: str) -> str:
    """Stable id → natural dedup. Prefer a hash of the canonical trip URL (the strongest trip
    identity); fall back to a destination/title slug so URL-less trips (typed/voice notes) dedupe."""
    if canonical_url:
        return "t_" + hashlib.sha1(canonical_url.encode("utf-8")).hexdigest()[:16]
    return f"t_{_slug(destination or title)}"


def _seed_user_state(doc: dict, now: datetime) -> None:
    """First time a trip is seen, seed the owner-editable state — in one place so the note-fan-out
    and any future path stay in sync and never reset existing state. Trips have no status buckets,
    so the only owner state is `favorite`."""
    doc["favorite"] = False
    doc["created_at"] = now


async def _geocode_days(days: list, destination: str | None, region: str | None) -> list:
    """Return a copy of `days` with each stop's `lat`/`lng` filled in from Google Places, best
    effort. No-op (returns days unchanged) when Places is disabled. Bounded by TRIP_MAX_GEOCODED_STOPS
    so a pathological many-stop trip can't run up the bill; stops past the cap keep their text and are
    simply absent from the map."""
    if not isinstance(days, list) or not google_places.enabled():
        return days
    budget = settings.TRIP_MAX_GEOCODED_STOPS
    out_days = []
    for day in days:
        if not isinstance(day, dict):
            out_days.append(day)
            continue
        stops = day.get("stops") or []
        out_stops = []
        for stop in stops:
            if isinstance(stop, dict) and stop.get("place") and budget > 0:
                budget -= 1
                place = stop["place"]
                try:
                    hit = await google_places.search_place(place, destination, region)
                except Exception as e:  # noqa: BLE001 — one stop's miss must not sink the rest.
                    log.warning("trip stop geocode failed for %r: %s: %s",
                                place, type(e).__name__, e)
                    hit = None
                if hit and hit.lat is not None and hit.lng is not None:
                    stop = {**stop, "lat": hit.lat, "lng": hit.lng}
            out_stops.append(stop)
        out_days.append({**day, "stops": out_stops})
    return out_days


async def enrich_trip_item(uid: str, source_id: str, *, title: str,
                           cover_image_url: str | None, source_url: str | None,
                           source_domain: str | None, data: dict | None,
                           region: str | None = None, ai_summary: str = "") -> str | None:
    """Upsert one trip_item from an itinerary note's already-extracted fields, geocoding its stops
    for the map. Best-effort and non-fatal: any failure logs and is swallowed so ingest never fails
    because of the trips app. Returns the produced trip_item id (for capture-destination routing),
    or None if skipped. `source_id` is the note id when a note exists, else the job id.

    Skips notes with no days — a travel-family slug that routed through the composer rather than the
    itinerary schema won't carry a day plan, and shouldn't pollute the wall."""
    data = data or {}
    days = data.get("days")
    if not days:
        return None  # nothing trip-like to track

    title = (title or "").strip() or "Untitled trip"
    destination = (data.get("destination") or "").strip() or None
    canonical = _canonical_url(source_url)

    try:
        region = region or await get_user_region(uid)
        days = await _geocode_days(days, destination, region)

        db = get_db()
        now = datetime.now(timezone.utc)
        doc_id = _doc_id(canonical, destination or "", title)
        ref = (db.collection("users").document(uid)
               .collection("trip_items").document(doc_id))
        existing = await ref.get()

        # Enrichment fields (always refreshed); never touch the user's `favorite` state here.
        enrichment = {
            "user_id": uid,
            "title": title,
            "destination": destination,
            "duration": data.get("duration") or None,
            "budget": data.get("budget") or None,
            "best_season": data.get("bestSeason") or None,
            "image_url": cover_image_url,
            "source_url": source_url or None,
            "domain": source_domain or None,
            "days": days,
            "tips": data.get("tips") or [],
            "source_note_ids": ArrayUnion([source_id]),
            "updated_at": now,
        }
        if not existing.exists:
            _seed_user_state(enrichment, now)
        await ref.set(enrichment, merge=True)
        await search_index.upsert(
            db, user_id=uid, kind="trip", ref_id=doc_id, title=title,
            summary=ai_summary or destination or "", cover_image_url=cover_image_url,
        )
        return doc_id
    except Exception as e:  # noqa: BLE001 — the trips wall must never sink an ingest.
        log.warning("trip_item enrichment failed for %r: %s: %s",
                    title, type(e).__name__, e)
        return None


async def backfill_user(uid: str, limit: int = 200) -> dict:
    """Populate trip_items from a user's EXISTING itinerary notes. Travel notes saved before the
    Trips app went through the generic composer (no days[]), so — like the places backfill —
    those get a one-off Gemini re-extraction (`extract_days_from_note`) off the STORED text (no
    re-scrape) that derives a day-by-day itinerary, returning empty for notes that aren't actually
    trips (single spots / roundups). Notes that already carry days[] are a pure copy.

    Idempotent: enrich_trip_item upserts by canonical URL and never clobbers user state, so
    re-running is safe. Returns a small summary."""
    from services.gemini import gemini_service, is_itinerary  # local import avoids a circular import

    db = get_db()
    region = await get_user_region(uid)
    notes_seen = 0
    trips_found = 0
    query = db.collection("notes").where("user_id", "==", uid)
    async for snap in query.stream():
        if notes_seen >= limit:
            break
        note = snap.to_dict() or {}
        if not is_itinerary(note.get("content_type", "")):
            continue
        notes_seen += 1
        try:
            data = note.get("data") or {}
            if not data.get("days"):
                # Older travel note without a day plan — re-derive one from its stored text.
                derived = await gemini_service.extract_days_from_note(
                    note.get("title", ""), note.get("ai_summary", ""), data,
                )
                if not derived.get("days"):
                    continue  # not actually a trip (single spot / roundup / tips)
                data = {**data, **derived}
            trips_found += 1
            await enrich_trip_item(
                uid, snap.id,
                title=note.get("title", ""),
                cover_image_url=note.get("cover_image_url"),
                source_url=note.get("source_url"),
                source_domain=note.get("source_domain"),
                data=data,
                region=region,
            )
        except Exception as e:  # noqa: BLE001 — one note must not sink the backfill.
            log.warning("trips backfill failed for note %s: %s: %s",
                        snap.id, type(e).__name__, e)
    log.info("trips backfill for %s: %d trip notes", uid, trips_found)
    return {"notes_processed": notes_seen, "trips_found": trips_found}
