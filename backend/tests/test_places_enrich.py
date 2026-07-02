"""Places enrichment: venues → place_items (place_id dedup, no-clobber, region action links)."""
import pytest

import services.places as pl
from services import google_places
from services.gemini import is_places
from services.google_places import PlaceHit

COL = "users/u/place_items"


@pytest.mark.parametrize("slug,expected", [
    ("place", True),
    ("restaurants", True),
    ("cafe", True),
    ("rooftop-bar", True),
    ("wine-bars", True),
    ("things-to-do", True),
    ("pub", True),
    ("public-speaking", False),   # 'pub' must not match as a substring
    ("barbell-workout", False),   # 'bar' must not match as a substring
    ("recipe", False),
    ("workout", False),
])
def test_is_places_token_boundaries(slug, expected):
    assert is_places(slug) is expected


def _hit(pid, name, **over):
    base = dict(place_id=pid, name=name, formatted_address="Addr, Mumbai",
                lat=19.1, lng=72.8, rating=4.5, user_rating_count=120,
                price_level="$$", category="Cafe", types=["cafe"],
                photo_name=f"places/{pid}/photos/y")
    base.update(over)
    return PlaceHit(**base)


@pytest.fixture(autouse=True)
def patch_deps(fake_db, monkeypatch):
    monkeypatch.setattr(pl, "get_db", lambda: fake_db)

    async def fake_region(uid):
        return "IN"
    monkeypatch.setattr(pl, "get_user_region", fake_region)

    catalog = {
        "Blue Tokai": _hit("p1", "Blue Tokai Coffee"),
        "Subko": _hit("p2", "Subko Bakery", category="Bakery"),
    }

    async def fake_search(name, location=None, region=None):
        return catalog.get(name)

    async def fake_details(place_id):
        for h in catalog.values():
            if h.place_id == place_id:
                return {
                    "place_id": place_id, "name": h.name,
                    "formatted_address": h.formatted_address, "lat": h.lat, "lng": h.lng,
                    "rating": h.rating, "user_rating_count": h.user_rating_count,
                    "price_level": h.price_level, "category": h.category,
                    "opening_hours": ["Mon: 9–9"], "website": "https://venue.com",
                    "phone": "+911234", "google_maps_url": "https://maps.google.com/?cid=1",
                    "reservable": True, "photo_url": f"https://lh3/{place_id}.jpg",
                }
        return None

    monkeypatch.setattr(google_places, "search_place", fake_search)
    monkeypatch.setattr(google_places, "place_details", fake_details)
    monkeypatch.setattr(google_places, "enabled", lambda: True)
    return fake_db


# --- pure helpers -----------------------------------------------------------------

def test_doc_id_matched_and_raw():
    assert pl._doc_id(_hit("p1", "X"), "X", "Mumbai") == "g_p1"
    assert pl._doc_id(None, "Some Spot", "Pune") == "raw_some-spot_pune"


def test_city_from_location():
    assert pl._city_from_location("Bandra, Mumbai") == "Mumbai"
    assert pl._city_from_location("") is None


def test_action_links_india_has_reserve_and_order():
    links = pl._action_links("IN", "Blue Tokai", "Mumbai", {}, {"place_id": "p1"})
    kinds = {l["kind"] for l in links}
    assert {"directions", "reserve", "order"} <= kinds
    reserve = next(l for l in links if l["kind"] == "reserve")
    assert "district.in" in reserve["url"]
    order = next(l for l in links if l["kind"] == "order")
    assert "swiggy.com" in order["url"]


def test_action_links_non_india_has_no_swiggy():
    links = pl._action_links("US", "Joe's", "NYC", {}, {})
    kinds = {l["kind"] for l in links}
    assert "directions" in kinds and "order" not in kinds


def test_action_links_source_booking_url_wins():
    links = pl._action_links("IN", "X", "Y", {"bookingUrl": "https://book.me/x"}, {})
    reserve = next(l for l in links if l["kind"] == "reserve")
    assert reserve["url"] == "https://book.me/x"


# --- fan-out ----------------------------------------------------------------------

async def test_list_fans_out_one_item_per_venue(fake_db):
    venues = [
        {"name": "Blue Tokai", "location": "Bandra, Mumbai", "highlights": ["filter coffee"],
         "mustTry": ["cold brew"], "why": "great beans"},
        {"name": "Subko", "location": "Colaba, Mumbai"},
    ]
    item_ids = await pl.enrich_places("u", "note-1", venues)
    assert (COL, "g_p1") in fake_db.docs
    assert (COL, "g_p2") in fake_db.docs
    item = fake_db.docs[(COL, "g_p1")]
    assert item["place_status"] == "saved"        # note-extracted venues start in Saved
    assert item["user_rating"] is None and item["user_notes"] is None
    assert item["rating"] == 4.5 and item["lat"] == 19.1
    assert item["photo_url"] == "https://lh3/p1.jpg"
    assert item["must_try"] == ["cold brew"]
    assert {l["kind"] for l in item["action_links"]} >= {"directions", "reserve", "order"}
    assert item_ids == ["g_p1", "g_p2"]            # produced item ids, for destination routing


async def test_unmatched_venue_still_creates_raw_item(fake_db):
    item_ids = await pl.enrich_places("u", "n1", [{"name": "Hidden Gem", "city": "Goa",
                                                   "website": "https://gem.in"}])
    raw = [k for k in fake_db.docs if k[0] == COL and k[1].startswith("raw_")]
    assert raw, "an unmatched venue should still produce a trackable item"
    assert fake_db.docs[raw[0]]["website"] == "https://gem.in"  # source contact preserved
    assert item_ids == [raw[0][1]]


async def test_resave_does_not_clobber_user_state(fake_db):
    fake_db.seed(COL, "g_p1", {
        "user_id": "u", "place_status": "visited", "user_rating": 5,
        "user_notes": "loved it", "visited_at": "earlier", "photo_url": "old.jpg",
    })
    await pl.enrich_places("u", "n2", [{"name": "Blue Tokai", "location": "Mumbai"}])
    item = fake_db.docs[(COL, "g_p1")]
    assert item["place_status"] == "visited"          # preserved
    assert item["user_rating"] == 5                    # preserved
    assert item["user_notes"] == "loved it"            # preserved
    assert item["visited_at"] == "earlier"             # preserved
    assert item["photo_url"] == "https://lh3/p1.jpg"   # enrichment refreshed


async def test_same_venue_across_notes_dedupes(fake_db):
    await pl.enrich_places("u", "n1", [{"name": "Blue Tokai", "location": "Mumbai"}])
    await pl.enrich_places("u", "n2", [{"name": "Blue Tokai", "location": "Mumbai"}])
    assert len([k for k in fake_db.docs if k[0] == COL]) == 1


async def test_empty_venues_is_noop(fake_db):
    assert await pl.enrich_places("u", "n1", []) == []
    assert not any(k[0] == COL for k in fake_db.docs)


async def test_add_by_place_id_creates_to_visit(fake_db):
    doc_id = await pl.add_by_place_id("u", "p1")
    assert doc_id == "g_p1"
    item = fake_db.docs[(COL, "g_p1")]
    assert item["place_status"] == "to_visit"   # manual adds skip the Saved inbox
    assert item["added_manually"] is True
    assert item["rating"] == 4.5


async def test_add_by_place_id_raises_on_miss(fake_db, monkeypatch):
    async def none_details(pid):
        return None
    monkeypatch.setattr(google_places, "place_details", none_details)
    with pytest.raises(ValueError):
        await pl.add_by_place_id("u", "nope")


async def test_backfill_reads_venues_and_filters_non_places(fake_db, monkeypatch):
    fake_db.seed("notes", "pl1", {"user_id": "u", "content_type": "place",
                                  "title": "Bandra cafes", "data": {"venues": [
                                      {"name": "Blue Tokai", "location": "Mumbai"}]}})
    fake_db.seed("notes", "pl2", {"user_id": "u", "content_type": "restaurants",
                                  "title": "Legacy roundup", "ai_summary": "two spots",
                                  "data": {}})  # no venues → re-extract
    fake_db.seed("notes", "r1", {"user_id": "u", "content_type": "recipe",
                                 "title": "Pasta", "data": {"servings": 2}})  # not places

    async def fake_extract(title, summary, data):
        return [{"name": "Subko", "location": "Mumbai"}]
    monkeypatch.setattr(pl.gemini_service, "extract_venues_from_note", fake_extract)

    res = await pl.backfill_user("u")
    assert res == {"notes_processed": 2, "venues_found": 2}
    assert (COL, "g_p1") in fake_db.docs and (COL, "g_p2") in fake_db.docs
