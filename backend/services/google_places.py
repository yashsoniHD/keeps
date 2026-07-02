"""Google Places (New) enrichment for the Places mini-app.

Given a venue extracted from a place note, match it to a Google Place and pull photo, rating,
price level, coordinates, opening hours, website, phone, and a Google Maps link. Designed like
`tmdb.py`: the pure parsing is unit-tested offline while the HTTP + Firestore-cache layer wraps it.

Auth is the runtime service account via Application Default Credentials (the same way Vertex and
Firestore authenticate) — no API key to manage. When credentials are unavailable or ENABLE_PLACES
is off, every public function is a graceful no-op (returns None / []), so a place note still saves
and its place_items render from the raw venue name.

Cost discipline (the budget guardrail): the Places API (New) bills per request and requires an
explicit X-Goog-FieldMask (omitting it 400s). We keep masks to Essentials-tier fields and cache
every search/details result in Firestore (places_cache) so a re-ingest of the same venues makes
zero new API calls.

Photos: the New Photo endpoint with skipHttpRedirect=true returns a keyless googleusercontent
`photoUri`. We resolve it server-side (inside the cached details payload) and store only that public
URL on the place_item — the server key is never exposed to the client.
"""
import asyncio
import logging
import re
import time
from dataclasses import asdict, dataclass, field

import google.auth
import google.auth.transport.requests
import httpx

from config import settings
from services.firebase import get_db

log = logging.getLogger("clipnote.google_places")

# ADC credentials, lazily loaded and cached process-wide; refreshed when the token expires.
_credentials = None
_auth_request: google.auth.transport.requests.Request | None = None
_creds_ok: bool | None = None


def _get_token() -> str | None:
    """A fresh OAuth access token for the runtime service account, or None if ADC is unavailable."""
    global _credentials, _auth_request
    try:
        if _credentials is None:
            _credentials, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/cloud-platform"])
            _auth_request = google.auth.transport.requests.Request()
        if not _credentials.valid:
            _credentials.refresh(_auth_request)
        return _credentials.token
    except Exception as e:  # noqa: BLE001
        log.warning("places ADC token unavailable: %s: %s", type(e).__name__, e)
        return None


# Google's PriceLevel enum → a compact display token.
PRICE_LEVEL_MAP = {
    "PRICE_LEVEL_FREE": "Free",
    "PRICE_LEVEL_INEXPENSIVE": "$",
    "PRICE_LEVEL_MODERATE": "$$",
    "PRICE_LEVEL_EXPENSIVE": "$$$",
    "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$",
}

# Essentials-tier fields only (keep the SKU cheap). Text Search masks are `places.`-prefixed.
SEARCH_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,places.location,"
    "places.rating,places.userRatingCount,places.priceLevel,places.primaryType,"
    "places.types,places.photos"
)
DETAILS_FIELD_MASK = (
    "id,displayName,formattedAddress,location,rating,userRatingCount,priceLevel,"
    "primaryType,types,photos,regularOpeningHours,websiteUri,internationalPhoneNumber,"
    "googleMapsUri,editorialSummary,reservable"
)


@dataclass
class PlaceHit:
    place_id: str
    name: str
    formatted_address: str | None = None
    lat: float | None = None
    lng: float | None = None
    rating: float | None = None
    user_rating_count: int | None = None
    price_level: str | None = None   # mapped to $ / $$ / …
    category: str | None = None      # humanized primaryType
    types: list[str] = field(default_factory=list)
    photo_name: str | None = None    # first photo resource name (resolve via photo_url)


def enabled() -> bool:
    """True when Places enrichment is on and ADC credentials are obtainable. The credential check
    is cached after the first call so the hot path stays cheap (requests refresh the token as
    needed); the actual HTTP calls run in a thread, so this brief first-time check is acceptable."""
    global _creds_ok
    if not settings.ENABLE_PLACES:
        return False
    if _creds_ok is None:
        _creds_ok = _get_token() is not None
    return _creds_ok


def _headers(field_mask: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {_get_token()}"}
    # Bill quota to the app's project (needed for ADC; harmless for the runtime SA).
    if settings.GOOGLE_CLOUD_PROJECT:
        h["X-Goog-User-Project"] = settings.GOOGLE_CLOUD_PROJECT
    if field_mask:
        h["X-Goog-FieldMask"] = field_mask
    return h


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "x"


# ---- pure parsing (unit-tested offline) -------------------------------------------------

def _price_level(raw: str | None) -> str | None:
    return PRICE_LEVEL_MAP.get(raw) if raw else None


def _humanize_type(t: str | None) -> str | None:
    """'italian_restaurant' → 'Italian restaurant'."""
    if not t:
        return None
    s = t.replace("_", " ").strip()
    return s[:1].upper() + s[1:] if s else None


def _hit_from_place(p: dict) -> PlaceHit | None:
    pid = p.get("id")
    if not pid:
        return None
    loc = p.get("location") or {}
    photos = p.get("photos") or []
    return PlaceHit(
        place_id=pid,
        name=(p.get("displayName") or {}).get("text") or "",
        formatted_address=p.get("formattedAddress"),
        lat=loc.get("latitude"),
        lng=loc.get("longitude"),
        rating=p.get("rating"),
        user_rating_count=p.get("userRatingCount"),
        price_level=_price_level(p.get("priceLevel")),
        category=_humanize_type(p.get("primaryType")),
        types=p.get("types") or [],
        photo_name=(photos[0].get("name") if photos else None),
    )


def _search_candidate(p: dict) -> dict | None:
    """Map one Text Search result to a lean candidate for the manual-add picker."""
    hit = _hit_from_place(p)
    if not hit:
        return None
    return {
        "place_id": hit.place_id,
        "name": hit.name,
        "formatted_address": hit.formatted_address,
        "rating": hit.rating,
        "price_level": hit.price_level,
        "category": hit.category,
    }


def _parse_details(raw: dict) -> dict:
    """Flatten a Place Details (New) response into a frontend-ready map. Pure — the photo URI is
    resolved separately (one extra call) and merged in by `place_details`."""
    loc = raw.get("location") or {}
    photos = raw.get("photos") or []
    hours = (raw.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []
    return {
        "place_id": raw.get("id"),
        "name": (raw.get("displayName") or {}).get("text") or "",
        "formatted_address": raw.get("formattedAddress"),
        "lat": loc.get("latitude"),
        "lng": loc.get("longitude"),
        "rating": raw.get("rating"),
        "user_rating_count": raw.get("userRatingCount"),
        "price_level": _price_level(raw.get("priceLevel")),
        "category": _humanize_type(raw.get("primaryType")),
        "opening_hours": hours,
        "website": raw.get("websiteUri"),
        "phone": raw.get("internationalPhoneNumber"),
        "google_maps_url": raw.get("googleMapsUri"),
        "editorial_summary": (raw.get("editorialSummary") or {}).get("text"),
        "reservable": raw.get("reservable"),
        "photo_name": (photos[0].get("name") if photos else None),
    }


# ---- HTTP + Firestore cache -------------------------------------------------------------

def _post_sync(path: str, body: dict, field_mask: str) -> dict | None:
    try:
        with httpx.Client(base_url=settings.GOOGLE_PLACES_API_BASE, timeout=8.0) as c:
            resp = c.post(path, json=body, headers=_headers(field_mask))
            resp.raise_for_status()
            return resp.json()
    except Exception as e:  # noqa: BLE001 — enrichment is best-effort; never raise into ingest.
        log.warning("places POST %s failed: %s: %s", path, type(e).__name__, e)
        return None


def _get_sync(path: str, field_mask: str | None = None, params: dict | None = None) -> dict | None:
    try:
        with httpx.Client(base_url=settings.GOOGLE_PLACES_API_BASE, timeout=8.0) as c:
            resp = c.get(path, headers=_headers(field_mask), params=params or {})
            resp.raise_for_status()
            return resp.json()
    except Exception as e:  # noqa: BLE001
        log.warning("places GET %s failed: %s: %s", path, type(e).__name__, e)
        return None


async def _post(path: str, body: dict, field_mask: str) -> dict | None:
    return await asyncio.to_thread(_post_sync, path, body, field_mask)


async def _get(path: str, field_mask: str | None = None, params: dict | None = None) -> dict | None:
    return await asyncio.to_thread(_get_sync, path, field_mask, params)


async def _cache_get(key: str, ttl_seconds: int) -> dict | None:
    try:
        snap = await get_db().collection("places_cache").document(key).get()
        if not snap.exists:
            return None
        doc = snap.to_dict() or {}
        if time.time() - (doc.get("cached_at") or 0) > ttl_seconds:
            return None
        return doc.get("payload")
    except Exception:  # noqa: BLE001
        return None


async def _cache_set(key: str, payload: dict) -> None:
    try:
        await get_db().collection("places_cache").document(key).set(
            {"payload": payload, "cached_at": time.time()}, merge=True
        )
    except Exception:  # noqa: BLE001
        pass


async def search_place(name: str, location: str | None = None,
                       region: str | None = None) -> PlaceHit | None:
    """Resolve a free-text venue to its best Google Place. Returns None when disabled, on a miss,
    or on any error — the caller keeps the raw venue and leaves Google fields null. Cached per
    (name, location, region); a miss is cached as {} so repeated misses don't re-hit the API."""
    if not enabled() or not name:
        return None
    region = (region or settings.DEFAULT_WATCH_REGION).upper()
    cache_key = f"search_{_slug(name)}_{_slug(location or '')}_{region}"
    cached = await _cache_get(cache_key, settings.PLACES_DETAIL_CACHE_HOURS * 3600)
    if cached is not None:
        if not cached:
            return None
        try:
            return PlaceHit(**cached)
        except TypeError:  # cached schema drift — refetch
            pass
    body = {"textQuery": f"{name} {location or ''}".strip(), "regionCode": region,
            "maxResultCount": 1}
    data = await _post("/places:searchText", body, SEARCH_FIELD_MASK)
    places = (data or {}).get("places") or []
    hit = _hit_from_place(places[0]) if places else None
    await _cache_set(cache_key, asdict(hit) if hit else {})
    return hit


async def place_details(place_id: str) -> dict | None:
    """Full place details (hours/website/phone/photo) for the detail page and enrichment. Cached
    per place_id for PLACES_DETAIL_CACHE_HOURS. The first photo is resolved to a keyless
    googleusercontent URI and merged in as `photo_url` (so the photo call is cached too)."""
    if not enabled() or not place_id:
        return None
    cache_key = f"details_{place_id}"
    cached = await _cache_get(cache_key, settings.PLACES_DETAIL_CACHE_HOURS * 3600)
    if cached is not None:
        return cached
    data = await _get(f"/places/{place_id}", DETAILS_FIELD_MASK)
    if not data or not data.get("id"):
        return None
    parsed = _parse_details(data)
    if parsed.get("photo_name"):
        parsed["photo_url"] = await photo_url(parsed["photo_name"])
    await _cache_set(cache_key, parsed)
    return parsed


async def photo_url(photo_name: str, max_w: int = 800) -> str | None:
    """Resolve a Place photo resource name to a keyless, publicly loadable googleusercontent URL
    (skipHttpRedirect returns the URI as JSON instead of a 302). None when disabled or on error."""
    if not enabled() or not photo_name:
        return None
    data = await _get(f"/{photo_name}/media",
                      params={"maxWidthPx": max_w, "skipHttpRedirect": "true"})
    return (data or {}).get("photoUri")


async def search(query: str, region: str | None = None, limit: int = 10) -> list[dict]:
    """Free-text search for the manual-add picker. Lean candidates. No-op ([]) when disabled or
    the query is blank. Not cached — the picker is interactive and queries are unique."""
    if not enabled() or not (query or "").strip():
        return []
    region = (region or settings.DEFAULT_WATCH_REGION).upper()
    body = {"textQuery": query.strip(), "regionCode": region, "maxResultCount": limit}
    data = await _post("/places:searchText", body, SEARCH_FIELD_MASK)
    places = (data or {}).get("places") or []
    out = [c for c in (_search_candidate(p) for p in places) if c]
    return out[:limit]
