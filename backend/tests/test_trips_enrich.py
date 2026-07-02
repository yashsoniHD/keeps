"""Trips enrichment: itinerary notes → trip_items (URL dedup, no-clobber, days guard, geocoding)."""
import pytest

import services.itineraries as it
from services import google_places
from services.gemini import is_itinerary
from services.google_places import PlaceHit

COL = "users/u/trip_items"


@pytest.fixture(autouse=True)
def patch_deps(fake_db, monkeypatch):
    monkeypatch.setattr(it, "get_db", lambda: fake_db)

    async def fake_region(uid):
        return "PT"
    monkeypatch.setattr(it, "get_user_region", fake_region)
    # Geocoding off by default; the geocode test flips it on.
    monkeypatch.setattr(google_places, "enabled", lambda: False)
    return fake_db


def _data(**over):
    base = {
        "destination": "Lisbon", "duration": "3 days", "budget": "€600",
        "bestSeason": "Spring",
        "days": [
            {"day": 1, "title": "Old town", "stops": [
                {"time": "09:00", "place": "Alfama", "note": "wander the lanes"},
                {"time": "13:00", "place": "Time Out Market", "note": "lunch"},
            ]},
            {"day": 2, "title": "Belém", "stops": [
                {"time": "10:00", "place": "Jerónimos Monastery", "note": "book ahead"},
            ]},
        ],
        "tips": ["Buy a Viva Viagem card"],
    }
    base.update(over)
    return base


# --- matcher ----------------------------------------------------------------------

@pytest.mark.parametrize("slug,expected", [
    ("itinerary", True),
    ("trip", True),
    ("road-trip", True),
    ("travel", True),
    ("vacation", True),
    ("getaway", True),
    ("recipe", False),
    ("place", False),
    ("product", False),
])
def test_is_itinerary(slug, expected):
    assert is_itinerary(slug) is expected


# --- pure helpers -----------------------------------------------------------------

def test_canonical_url_strips_tracking_and_fragment():
    a = it._canonical_url("https://Travel.com/lisbon/?utm_source=x&gclid=y#map")
    b = it._canonical_url("https://travel.com/lisbon?ref=newsletter")
    assert a == b == "https://travel.com/lisbon"


def test_doc_id_prefers_url_then_falls_back_to_destination():
    assert it._doc_id("https://travel.com/lisbon", "Lisbon", "A weekend").startswith("t_")
    assert it._doc_id(None, "Lisbon", "A weekend") == "t_lisbon"
    assert it._doc_id(None, "", "A weekend in Porto") == "t_a-weekend-in-porto"


# --- fan-out ----------------------------------------------------------------------

async def test_itinerary_note_fans_out_into_a_trip_item(fake_db):
    await it.enrich_trip_item("u", "note-1", title="A weekend in Lisbon",
                              cover_image_url="https://img/x.jpg",
                              source_url="https://travel.com/lisbon",
                              source_domain="travel.com", data=_data())
    keys = [k for k in fake_db.docs if k[0] == COL]
    assert len(keys) == 1
    item = fake_db.docs[keys[0]]
    assert item["title"] == "A weekend in Lisbon"
    assert item["destination"] == "Lisbon"
    assert item["duration"] == "3 days"
    assert item["budget"] == "€600"
    assert item["best_season"] == "Spring"
    assert item["image_url"] == "https://img/x.jpg"
    assert item["source_url"] == "https://travel.com/lisbon"
    assert len(item["days"]) == 2
    assert item["days"][0]["stops"][0]["place"] == "Alfama"
    assert item["tips"] == ["Buy a Viva Viagem card"]
    # user state seeded once.
    assert item["favorite"] is False
    assert item["created_at"] is not None


async def test_same_trip_across_notes_dedupes_by_canonical_url(fake_db):
    await it.enrich_trip_item("u", "n1", title="Lisbon", cover_image_url=None,
                              source_url="https://travel.com/lisbon?utm_source=ig",
                              source_domain="travel.com", data=_data())
    await it.enrich_trip_item("u", "n2", title="Lisbon (again)", cover_image_url=None,
                              source_url="https://travel.com/lisbon?ref=mail",
                              source_domain="travel.com", data=_data())
    assert len([k for k in fake_db.docs if k[0] == COL]) == 1  # one trip, not two


async def test_urlless_trip_keyed_by_destination(fake_db):
    await it.enrich_trip_item("u", "n1", title="My big trip", cover_image_url=None,
                              source_url=None, source_domain=None, data=_data(destination="Porto"))
    key = [k for k in fake_db.docs if k[0] == COL][0]
    assert key[1] == "t_porto"


async def test_resave_does_not_clobber_favorite(fake_db):
    fake_db.seed(COL, "seed", {})  # noise
    await it.enrich_trip_item("u", "n1", title="Lisbon", cover_image_url=None,
                              source_url="https://travel.com/lisbon",
                              source_domain="travel.com", data=_data())
    item_key = [k for k in fake_db.docs if k[0] == COL and k[1] != "seed"][0]
    fake_db.docs[item_key].update({"favorite": True})
    # Re-save with refreshed data.
    await it.enrich_trip_item("u", "n2", title="Lisbon", cover_image_url=None,
                              source_url="https://travel.com/lisbon",
                              source_domain="travel.com", data=_data(duration="4 days"))
    item = fake_db.docs[item_key]
    assert item["favorite"] is True        # preserved
    assert item["duration"] == "4 days"    # enrichment refreshed


async def test_skips_note_with_no_days(fake_db):
    # A travel-family composer note (no day plan) must not create a junk item.
    await it.enrich_trip_item("u", "n1", title="10 travel hacks", cover_image_url=None,
                              source_url="https://blog.com/hacks", source_domain="blog.com",
                              data={"sections": [{"heading": "Hacks", "body": "..."}]})
    assert not any(k[0] == COL for k in fake_db.docs)


async def test_stops_are_geocoded_when_places_enabled(fake_db, monkeypatch):
    catalog = {
        "Alfama": (38.71, -9.13),
        "Jerónimos Monastery": (38.70, -9.21),
        # "Time Out Market" intentionally absent → that stop stays coordinate-less.
    }

    async def fake_search(name, location=None, region=None):
        coords = catalog.get(name)
        if not coords:
            return None
        return PlaceHit(place_id="x", name=name, lat=coords[0], lng=coords[1])

    monkeypatch.setattr(google_places, "enabled", lambda: True)
    monkeypatch.setattr(google_places, "search_place", fake_search)

    await it.enrich_trip_item("u", "n1", title="Lisbon", cover_image_url=None,
                              source_url="https://travel.com/lisbon",
                              source_domain="travel.com", data=_data())
    item = fake_db.docs[[k for k in fake_db.docs if k[0] == COL][0]]
    d1 = item["days"][0]["stops"]
    assert d1[0]["lat"] == 38.71 and d1[0]["lng"] == -9.13   # Alfama geocoded
    assert "lat" not in d1[1]                                 # Time Out Market: miss, no coords
    assert item["days"][1]["stops"][0]["lat"] == 38.70        # Jerónimos geocoded


async def test_backfill_copies_existing_itinerary_notes(fake_db, monkeypatch):
    # Re-extraction is only invoked for notes without days[]; make it a no-trip by default so this
    # test exercises only the pure-copy path.
    async def no_days(title, ai_summary, data):
        return {"days": []}
    from services.gemini import gemini_service
    monkeypatch.setattr(gemini_service, "extract_days_from_note", no_days)

    fake_db.seed("notes", "i1", {"user_id": "u", "content_type": "itinerary",
                                 "title": "Lisbon", "cover_image_url": "https://i/1.jpg",
                                 "source_url": "https://travel.com/lisbon",
                                 "source_domain": "travel.com", "data": _data()})
    fake_db.seed("notes", "t1", {"user_id": "u", "content_type": "road-trip",
                                 "title": "California 1", "data": _data(destination="California")})
    fake_db.seed("notes", "p1", {"user_id": "u", "content_type": "product",
                                 "title": "Bag", "data": {"price": "$10"}})  # not a trip family
    fake_db.seed("notes", "x1", {"user_id": "u", "content_type": "travel",
                                 "title": "Tips", "data": {"sections": []}})  # no days, re-extract empty
    res = await it.backfill_user("u")
    assert res == {"notes_processed": 3, "trips_found": 2}  # x1 counted but yields no trip
    assert len([k for k in fake_db.docs if k[0] == COL]) == 2


async def test_backfill_reextracts_days_for_dayless_travel_note(fake_db, monkeypatch):
    # A travel note saved before Trips: generic-composer data, no days[]. The backfill re-extracts a
    # day plan from its stored text and fans it out.
    async def fake_extract(title, ai_summary, data):
        assert "Meghalaya" in title
        return {"destination": "Meghalaya", "duration": "6 days",
                "days": [{"day": 1, "title": "Shillong", "stops": [{"place": "Umiam Lake"}]}]}
    from services.gemini import gemini_service
    monkeypatch.setattr(gemini_service, "extract_days_from_note", fake_extract)

    fake_db.seed("notes", "m1", {"user_id": "u", "content_type": "travel-destination-guide",
                                 "title": "Ultimate 6-day Meghalaya itinerary",
                                 "source_url": "https://ig.com/reel/x",
                                 "data": {"sections": [{"heading": "Day 1"}], "facts": []}})
    res = await it.backfill_user("u")
    assert res["trips_found"] == 1
    item = fake_db.docs[[k for k in fake_db.docs if k[0] == COL][0]]
    assert item["destination"] == "Meghalaya"
    assert item["days"][0]["stops"][0]["place"] == "Umiam Lake"
