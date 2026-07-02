"""Google Places (New): pure parsing + the Firestore search cache."""
import pytest

import services.google_places as gp
from config import settings


# --- pure parsing -----------------------------------------------------------------

def test_price_level_and_humanize():
    assert gp._price_level("PRICE_LEVEL_MODERATE") == "$$"
    assert gp._price_level("PRICE_LEVEL_FREE") == "Free"
    assert gp._price_level(None) is None
    assert gp._humanize_type("italian_restaurant") == "Italian restaurant"
    assert gp._humanize_type(None) is None


def test_hit_from_place_parses():
    p = {
        "id": "p1", "displayName": {"text": "Blue Tokai"}, "formattedAddress": "A, Mumbai",
        "location": {"latitude": 19.1, "longitude": 72.8},
        "rating": 4.5, "userRatingCount": 99, "priceLevel": "PRICE_LEVEL_INEXPENSIVE",
        "primaryType": "coffee_shop", "types": ["cafe"],
        "photos": [{"name": "places/p1/photos/x"}],
    }
    hit = gp._hit_from_place(p)
    assert hit.place_id == "p1" and hit.name == "Blue Tokai"
    assert hit.lat == 19.1 and hit.lng == 72.8
    assert hit.price_level == "$" and hit.category == "Coffee shop"
    assert hit.photo_name == "places/p1/photos/x"
    assert gp._hit_from_place({}) is None  # no id → not a usable hit


def test_parse_details_flattens():
    raw = {
        "id": "p1", "displayName": {"text": "X"}, "formattedAddress": "A",
        "location": {"latitude": 1.0, "longitude": 2.0}, "rating": 4.0,
        "regularOpeningHours": {"weekdayDescriptions": ["Mon: 9–5"]},
        "websiteUri": "https://x.com", "internationalPhoneNumber": "+91 1",
        "googleMapsUri": "https://maps/x", "editorialSummary": {"text": "nice"},
        "reservable": True, "photos": [{"name": "places/p1/photos/y"}],
    }
    d = gp._parse_details(raw)
    assert d["opening_hours"] == ["Mon: 9–5"]
    assert d["website"] == "https://x.com" and d["phone"] == "+91 1"
    assert d["photo_name"] == "places/p1/photos/y" and d["editorial_summary"] == "nice"
    assert d["reservable"] is True


def test_search_candidate_lean_shape():
    p = {"id": "p1", "displayName": {"text": "X"}, "rating": 4.2,
         "priceLevel": "PRICE_LEVEL_EXPENSIVE", "primaryType": "bar"}
    c = gp._search_candidate(p)
    assert c == {"place_id": "p1", "name": "X", "formatted_address": None,
                 "rating": 4.2, "price_level": "$$$", "category": "Bar"}


# --- auth (ADC) -------------------------------------------------------------------

def test_headers_use_adc_bearer(monkeypatch):
    monkeypatch.setattr(gp, "_get_token", lambda: "tok123")
    h = gp._headers("places.id,places.displayName")
    assert h["Authorization"] == "Bearer tok123"
    assert h["X-Goog-FieldMask"] == "places.id,places.displayName"
    assert h["X-Goog-User-Project"]  # quota billed to the app project


def test_enabled_gates_on_flag_and_creds(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_PLACES", False)
    monkeypatch.setattr(gp, "_creds_ok", None)
    assert gp.enabled() is False

    monkeypatch.setattr(settings, "ENABLE_PLACES", True)
    monkeypatch.setattr(gp, "_creds_ok", None)
    monkeypatch.setattr(gp, "_get_token", lambda: None)  # ADC unavailable
    assert gp.enabled() is False

    monkeypatch.setattr(gp, "_creds_ok", None)
    monkeypatch.setattr(gp, "_get_token", lambda: "tok")
    assert gp.enabled() is True


# --- HTTP + cache -----------------------------------------------------------------

async def test_search_place_disabled_is_noop(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_PLACES", False)
    assert await gp.search_place("X", "Y", "IN") is None


async def test_search_place_caches_hit(fake_db, monkeypatch):
    monkeypatch.setattr(gp, "enabled", lambda: True)  # pretend ADC is available
    monkeypatch.setattr(gp, "get_db", lambda: fake_db)
    calls = {"n": 0}

    async def fake_post(path, body, mask):
        calls["n"] += 1
        return {"places": [{"id": "p1", "displayName": {"text": "X"},
                            "location": {"latitude": 1, "longitude": 2}}]}
    monkeypatch.setattr(gp, "_post", fake_post)

    a = await gp.search_place("X", "Mumbai", "IN")
    b = await gp.search_place("X", "Mumbai", "IN")
    assert a.place_id == "p1" and b.place_id == "p1"
    assert calls["n"] == 1  # second call served from places_cache


async def test_search_place_caches_miss(fake_db, monkeypatch):
    monkeypatch.setattr(gp, "enabled", lambda: True)  # pretend ADC is available
    monkeypatch.setattr(gp, "get_db", lambda: fake_db)
    calls = {"n": 0}

    async def fake_post(path, body, mask):
        calls["n"] += 1
        return {"places": []}
    monkeypatch.setattr(gp, "_post", fake_post)

    assert await gp.search_place("Nowhere", "x", "IN") is None
    assert await gp.search_place("Nowhere", "x", "IN") is None
    assert calls["n"] == 1  # a miss is cached as {} so it doesn't re-hit the API
