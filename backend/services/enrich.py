"""Note enrichment: external data merged onto the note's own `data` map.

The mini-apps used to fan a capture out into per-item docs (watch/wish/place/recipe/trip_items)
and the note was never written. Notes-first inverts that: every capture is a note, and the
enrichment the apps performed — TMDB posters + "where to watch" providers, Google Places
photos/ratings/coords + action links, itinerary stop geocoding, price parsing — lands *inside*
`note.data`, where the note templates render it.

`enrich_note_data` is the single entry point, dispatched on the same content-type matchers that
used to route mini-app fan-out (`is_entertainment` etc., still owned by gemini.py). Everything is
best-effort: a miss at any level (API disabled, no match, network error) leaves a valid plain
note — enrichment must never sink an ingest.

Enriched fields use snake_case (poster_url, providers, action_links, lat/lng…) to distinguish
them from the camelCase fields Gemini extracts (mustTry, priceForTwo…): source-said vs looked-up.
"""
import logging
import re
from urllib.parse import quote_plus

from config import settings
from services import google_places, tmdb
from services.firebase import get_db
from services.gemini import (is_entertainment, is_itinerary, is_places,
                             is_shopping)

log = logging.getLogger("clipnote.enrich")

# A leading currency token + the first number in a price string ("₹2,499", "Rs. 1,200", "$19.99").
_PRICE_RE = re.compile(
    r"(₹|\$|€|£|¥|Rs\.?|INR|USD|EUR|GBP|AED|CAD|AUD)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)",
    re.I,
)


async def get_user_region(uid: str) -> str:
    """The user's region (ISO-3166-1 alpha-2), set by the frontend on sign-in; feeds streaming
    providers and reservation/order deep-links. Falls back to DEFAULT_WATCH_REGION."""
    try:
        snap = await get_db().collection("users").document(uid).get()
        region = (snap.to_dict() or {}).get("region") if snap.exists else None
    except Exception:  # noqa: BLE001
        region = None
    return (region or settings.DEFAULT_WATCH_REGION).upper()


# ---- shopping: price parsing --------------------------------------------------------------

def parse_price(raw) -> tuple[float | None, str | None]:
    """Best-effort split of a price string into a numeric amount (for sorting) and a currency
    token (for display). Returns (None, None) when nothing parses."""
    if not isinstance(raw, str):
        return None, None
    m = _PRICE_RE.search(raw)
    if not m:
        return None, None
    currency = (m.group(1) or "").strip() or None
    try:
        amount = float(m.group(2).replace(",", ""))
    except (ValueError, AttributeError):
        amount = None
    return amount, currency


# ---- entertainment: TMDB ------------------------------------------------------------------

async def _enrich_titles(titles: list, region: str) -> tuple[list, str | None]:
    """Match each extracted title to TMDB and merge poster/providers/overview onto it in place.
    Returns (titles, first_poster_url) — the poster is the cover candidate for coverless notes."""
    cover: str | None = None
    out: list = []
    for t in titles:
        if not isinstance(t, dict) or not (t.get("title") or "").strip():
            out.append(t)
            continue
        try:
            hit = await tmdb.search_title(
                t["title"].strip(), t.get("year"), t.get("mediaType"))
            if hit:
                providers = await tmdb.watch_providers(hit.tmdb_id, hit.media_type, region)
                t = {
                    **t,
                    "title": hit.title,
                    "year": hit.year or t.get("year"),
                    "mediaType": hit.media_type,
                    "tmdb_id": hit.tmdb_id,
                    "poster_url": hit.poster_url,
                    "backdrop_url": hit.backdrop_url,
                    "overview": hit.overview,
                    "genres": hit.genres,
                    "providers": providers,
                    "providers_region": region,
                }
                cover = cover or hit.poster_url
        except Exception as e:  # noqa: BLE001 — one title's miss must not sink the rest.
            log.warning("title enrichment failed for %r: %s: %s",
                        t.get("title"), type(e).__name__, e)
        out.append(t)
    return out, cover


# ---- places: Google Places ----------------------------------------------------------------

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


def _action_links(name: str, city: str | None,
                  venue: dict, details: dict) -> list[dict]:
    """Action row: Directions (Google Maps) + any real website/instagram/phone the source or
    Google provided. Reserve/Order deep-links were dropped — they only ever landed on a
    platform search (no stable per-venue URL) and added clutter."""
    name = name or ""
    links: list[dict] = [{
        "label": "Directions", "kind": "directions",
        "url": _maps_url(name, city, details.get("place_id"), details.get("google_maps_url")),
    }]

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


def _enrichment_from_details(venue: dict, details: dict) -> dict:
    """Google fields merged onto a venue (looked-up, never source-said)."""
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


async def _enrich_venues(venues: list, region: str) -> tuple[list, str | None]:
    """Match each extracted venue to Google Places and merge photo/rating/coords/action links
    onto it. Returns (venues, first_photo_url) — the photo is the cover candidate."""
    cover: str | None = None
    out: list = []
    for v in venues:
        if not isinstance(v, dict) or not (v.get("name") or "").strip():
            out.append(v)
            continue
        name = v["name"].strip()
        location = v.get("location") or ""
        city = v.get("city") or _city_from_location(location)
        try:
            hit = await google_places.search_place(name, location, region)
            details = (await google_places.place_details(hit.place_id)) if hit else None
            v = dict(v)
            if hit:
                v["place_id"] = hit.place_id
                v["name"] = (details or {}).get("name") or hit.name or name
            if details:
                v.update(_enrichment_from_details(v, details))
                cover = cover or details.get("photo_url")
            v["action_links"] = _action_links(v["name"], city, v, details or {})
        except Exception as e:  # noqa: BLE001 — one venue's miss must not sink the rest.
            log.warning("venue enrichment failed for %r: %s: %s", name, type(e).__name__, e)
        out.append(v)
    return out, cover


# ---- trips: stop geocoding ----------------------------------------------------------------

async def _geocode_days(days: list, destination: str | None, region: str | None) -> list:
    """Return a copy of `days` with each stop's `lat`/`lng` filled in from Google Places, best
    effort. No-op (returns days unchanged) when Places is disabled. Bounded by
    TRIP_MAX_GEOCODED_STOPS so a pathological many-stop trip can't run up the bill; stops past
    the cap keep their text and are simply absent from the map."""
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


# ---- entry point ----------------------------------------------------------------------------

async def enrich_note_data(user_id: str, content_type: str, data: dict | None,
                           cover_image_url: str | None) -> tuple[dict, str | None]:
    """Enrich a freshly-extracted note's `data` in place, per its content family. Returns
    (data, cover_override) — cover_override is a poster/photo to adopt ONLY when the note is
    otherwise coverless (real source imagery always wins). Best-effort throughout: any failure
    returns the data unchanged."""
    data = data or {}
    cover: str | None = None
    try:
        if is_entertainment(content_type) and isinstance(data.get("titles"), list):
            region = await get_user_region(user_id)
            data["titles"], cover = await _enrich_titles(data["titles"], region)
        elif is_places(content_type) and isinstance(data.get("venues"), list):
            region = await get_user_region(user_id)
            data["venues"], cover = await _enrich_venues(data["venues"], region)
        elif is_itinerary(content_type) and isinstance(data.get("days"), list):
            region = await get_user_region(user_id)
            data["days"] = await _geocode_days(
                data["days"], (data.get("destination") or "").strip() or None, region)
        elif is_shopping(content_type) and data.get("price"):
            amount, currency = parse_price(data.get("price"))
            if amount is not None:
                data["price_amount"] = amount
            if currency:
                data["currency"] = currency
        # recipes need no external enrichment — the note data is already complete.
    except Exception as e:  # noqa: BLE001 — enrichment must never sink an ingest.
        log.warning("note enrichment failed (%s): %s: %s", content_type, type(e).__name__, e)
    return data, (cover if not cover_image_url else None)
