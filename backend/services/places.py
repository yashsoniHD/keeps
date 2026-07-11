"""Places mini-app: fan extracted venues out into per-venue place_items.

Each place note can name several venues (a "5 best cafes" reel); each distinct venue becomes one
trackable doc under users/{uid}/place_items, Google-Places-enriched (photo, rating, hours, coords)
and deduped by Google place_id across notes. Items carry their own user state
(place_status / user_rating / user_notes / visited_at) which a re-save must never reset.

This mirrors services/watchlist.py (TMDB → Google Places). Region (users/{uid}.region, shared with
the watchlist) selects the dining/delivery deep-links in the per-venue action row.
"""
import logging
import re
from datetime import datetime, timezone
from urllib.parse import quote_plus

from google.cloud.firestore_v1 import ArrayUnion

from services import google_places, search_index
from services.firebase import get_db
from services.gemini import gemini_service, is_places
from services.watchlist import get_user_region  # shared region resolver (users/{uid}.region)

log = logging.getLogger("clipnote.places")


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "untitled"


def _doc_id(hit: google_places.PlaceHit | None, name: str, city: str | None) -> str:
    """Stable id → natural dedup. Matched venues key on the Google place_id; unmatched fall back
    to a name|city slug so the same raw venue doesn't duplicate either."""
    if hit:
        return f"g_{hit.place_id}"
    return f"raw_{_slug(name)}_{_slug(city or 'na')}"


def _city_from_location(location: str | None) -> str | None:
    if not location:
        return None
    parts = [p.strip() for p in location.split(",") if p.strip()]
    return parts[-1] if parts else None


def _maps_url(name: str, city: str | None, place_id: str | None,
              google_maps_url: str | None) -> str:
    if google_maps_url:
        return google_maps_url
    q = quote_plus(f"{name} {city or ''}".strip())
    url = f"https://www.google.com/maps/search/?api=1&query={q}"
    if place_id:
        url += f"&query_place_id={place_id}"
    return url


def _action_links(region: str | None, name: str, city: str | None,
                  venue: dict, details: dict) -> list[dict]:
    """Region-aware action row. Reliable anchor = Google Maps (Directions). India gets
    District (reserve) + Swiggy (order) SEARCH deep-links — neither exposes a stable per-venue
    URL without their internal IDs, so these land on the platform's search for the venue. Any
    real booking/website/instagram/phone the source provided wins over the derived link."""
    region = (region or "").upper()
    name = name or ""
    q = quote_plus(f"{name} {city or ''}".strip())
    links: list[dict] = [{
        "label": "Directions", "kind": "directions",
        "url": _maps_url(name, city, details.get("place_id"), details.get("google_maps_url")),
    }]

    booking = venue.get("bookingUrl")
    if booking:
        links.append({"label": "Reserve", "kind": "reserve", "url": booking})
    elif region == "IN":
        links.append({"label": "Reserve", "kind": "reserve",
                      "url": f"https://www.district.in/search?q={q}"})

    if region == "IN":
        links.append({"label": "Order", "kind": "order",
                      "url": f"https://www.swiggy.com/search?query={q}"})

    website = venue.get("website") or details.get("website")
    if website:
        links.append({"label": "Website", "kind": "website", "url": website})

    ig = venue.get("instagram")
    if ig:
        url = ig if ig.startswith("http") else f"https://instagram.com/{ig.lstrip('@')}"
        links.append({"label": "Instagram", "kind": "instagram", "url": url})

    phone = venue.get("phone") or details.get("phone")
    if phone:
        links.append({"label": "Call", "kind": "call",
                      "url": "tel:" + re.sub(r"[^+0-9]", "", phone)})
    return links


def _seed_user_state(doc: dict, now: datetime, status: str = "saved") -> None:
    """First time a venue is seen, seed the owner-editable state. Kept in one place so the
    note-enrichment and manual-add paths stay in sync and never reset existing state.

    Note-extracted venues land in the `saved` inbox (the default) and the user promotes them to
    `to_visit`; a manual add (searching for a venue is intent) skips the inbox → starts `to_visit`."""
    doc["place_status"] = status
    doc["user_rating"] = None
    doc["user_notes"] = None
    doc["visited_at"] = None
    doc["visit_count"] = 0
    doc["favorite"] = False
    doc["created_at"] = now


def _enrichment_from_details(venue: dict, details: dict) -> dict:
    """Google fields that are always refreshed on a venue's place_item (never user state)."""
    return {
        "formatted_address": details.get("formatted_address"),
        "lat": details.get("lat"),
        "lng": details.get("lng"),
        "rating": details.get("rating"),
        "user_rating_count": details.get("user_rating_count"),
        "price_level": details.get("price_level"),
        "opening_hours": details.get("opening_hours") or [],
        "website": venue.get("website") or details.get("website"),
        "phone": venue.get("phone") or details.get("phone"),
        "google_maps_url": details.get("google_maps_url"),
        "reservable": details.get("reservable"),
        "photo_url": details.get("photo_url"),
    }


async def enrich_places(uid: str, source_id: str, venues: list[dict],
                        region: str | None = None) -> list[str]:
    """Match each extracted venue to Google Places and upsert a place_item. Best-effort and
    non-fatal: any failure logs and is swallowed so ingest never fails because of Places. Returns
    the list of produced place_item ids (for capture-destination routing). `source_id` is the note
    id when a note exists, else the job id (mini-app captures no longer create a note)."""
    if not venues:
        return []
    region = region or await get_user_region(uid)
    db = get_db()
    now = datetime.now(timezone.utc)
    item_ids: list[str] = []

    for v in venues:
        name = (v.get("name") or "").strip()
        if not name:
            continue
        location = v.get("location") or ""
        city = v.get("city") or _city_from_location(location)
        try:
            hit = await google_places.search_place(name, location, region)
            details = await google_places.place_details(hit.place_id) if hit else None

            doc_id = _doc_id(hit, name, city)
            ref = db.collection("users").document(uid).collection("place_items").document(doc_id)
            existing = await ref.get()

            # Source fields (always refreshed); never touch the user's place state here.
            enrichment = {
                "user_id": uid,
                "name": (details or {}).get("name") or (hit.name if hit else name),
                "location": location or (details or {}).get("formatted_address") or None,
                "city": city or None,
                "category": (v.get("category") or (details or {}).get("category")
                             or (hit.category if hit else None)),
                "cuisine": v.get("cuisine") or None,
                "price_for_two": v.get("priceForTwo") or None,
                "must_try": v.get("mustTry") or [],
                "good_for": v.get("goodFor") or [],
                "best_time": v.get("bestTime") or None,
                "reservation_needed": v.get("reservationNeeded"),
                "highlights": v.get("highlights") or [],
                "tips": v.get("tips") or [],
                "why": v.get("why") or None,
                "source_note_ids": ArrayUnion([source_id]),
                "updated_at": now,
            }
            if hit:
                enrichment["place_id"] = hit.place_id
            if details:
                enrichment.update(_enrichment_from_details(v, details))
            else:
                # No Google match — still surface any source-provided contact fields.
                if v.get("website"):
                    enrichment["website"] = v["website"]
                if v.get("phone"):
                    enrichment["phone"] = v["phone"]
            enrichment["action_links"] = _action_links(
                region, enrichment["name"], city, v, details or {})

            if not existing.exists:
                _seed_user_state(enrichment, now)

            await ref.set(enrichment, merge=True)
            await search_index.upsert(
                db, user_id=uid, kind="place", ref_id=doc_id, title=enrichment["name"] or name,
                summary=v.get("why") or enrichment.get("category") or "",
                cover_image_url=(details or {}).get("photo_url"),
            )
            item_ids.append(doc_id)
        except Exception as e:  # noqa: BLE001 — one venue's failure must not sink the rest.
            log.warning("place_item enrichment failed for %r: %s: %s",
                        name, type(e).__name__, e)

    return item_ids


async def add_by_place_id(uid: str, place_id: str, region: str | None = None) -> str:
    """Manually add a venue the user picked from Places search. Upserts the same doc shape as
    note-enrichment (keyed by place_id so a later note-mention dedupes to one doc) and seeds user
    state only when new (status `to_visit`). Returns the doc id. Requires the Places key."""
    if not google_places.enabled():
        raise ValueError("Places API is not configured.")
    region = region or await get_user_region(uid)
    details = await google_places.place_details(place_id)
    if not details:
        raise ValueError("Place not found.")

    db = get_db()
    now = datetime.now(timezone.utc)
    doc_id = f"g_{place_id}"
    ref = db.collection("users").document(uid).collection("place_items").document(doc_id)
    existing = await ref.get()
    city = _city_from_location(details.get("formatted_address"))

    enrichment = {
        "user_id": uid,
        "place_id": place_id,
        "name": details.get("name"),
        "location": details.get("formatted_address"),
        "city": city,
        "category": details.get("category"),
        "highlights": [],
        "tips": [],
        "must_try": [],
        "good_for": [],
        "added_manually": True,
        "source_note_ids": [],
        "updated_at": now,
    }
    enrichment.update(_enrichment_from_details({}, details))
    enrichment["action_links"] = _action_links(region, details.get("name"), city, {}, details)
    if not existing.exists:
        _seed_user_state(enrichment, now, status="to_visit")
    await ref.set(enrichment, merge=True)
    await search_index.upsert(
        db, user_id=uid, kind="place", ref_id=doc_id, title=details.get("name") or "",
        summary=details.get("category") or "", cover_image_url=details.get("photo_url"),
    )
    return doc_id


async def backfill_user(uid: str, limit: int = 100) -> dict:
    """Populate place_items from a user's EXISTING place notes (saved before the venues[] schema,
    so they carry no venues[]). For each such note we read its `data.venues` or, failing that,
    extract the named venues from its stored text (no re-scrape) and enrich into place_items.

    Idempotent: enrich_places upserts by place_id and never clobbers user state, so re-running is
    safe. Returns a small summary."""
    db = get_db()
    region = await get_user_region(uid)
    notes_seen = 0
    venues_found = 0
    query = db.collection("notes").where("user_id", "==", uid)
    async for snap in query.stream():
        if notes_seen >= limit:
            break
        note = snap.to_dict() or {}
        if not is_places(note.get("content_type", "")):
            continue
        notes_seen += 1
        try:
            data = note.get("data") or {}
            venues = data.get("venues")
            if not venues:
                venues = await gemini_service.extract_venues_from_note(
                    note.get("title", ""), note.get("ai_summary", ""), data,
                )
            if venues:
                venues_found += len(venues)
                await enrich_places(uid, snap.id, venues, region=region)
        except Exception as e:  # noqa: BLE001 — one note must not sink the backfill.
            log.warning("places backfill failed for note %s: %s: %s",
                        snap.id, type(e).__name__, e)
    log.info("places backfill for %s: %d notes, %d venues", uid, notes_seen, venues_found)
    return {"notes_processed": notes_seen, "venues_found": venues_found}
