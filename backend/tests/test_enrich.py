"""enrich_note_data: external enrichment merged onto the note's own `data` map.

Dispatch follows the content-family matchers; every path is best-effort (a miss leaves a
valid plain note) and the returned cover is only a candidate for coverless notes.
"""
import pytest

import services.enrich as enrich
from services.tmdb import TmdbHit


@pytest.fixture(autouse=True)
def _region(monkeypatch):
    async def fake_region(uid):
        return "IN"
    monkeypatch.setattr(enrich, "get_user_region", fake_region)


async def test_entertainment_titles_gain_tmdb_fields_and_cover(monkeypatch):
    async def fake_search(title, year=None, media_hint=None):
        if title == "Dune":
            return TmdbHit(tmdb_id=1, media_type="movie", title="Dune", year="2021",
                           poster_url="https://img/dune.jpg", overview="Spice.",
                           genres=["Sci-Fi"])
        return None  # the second title doesn't match — must survive unenriched

    async def fake_providers(tmdb_id, media_type, region):
        return [{"name": "Netflix", "logo_url": None, "type": "flatrate"}]

    monkeypatch.setattr(enrich.tmdb, "search_title", fake_search)
    monkeypatch.setattr(enrich.tmdb, "watch_providers", fake_providers)

    data = {"titles": [{"title": "Dune", "mediaType": "movie"},
                       {"title": "Obscure Short", "why": "hidden gem"}]}
    out, cover = await enrich.enrich_note_data("u", "movie-recommendations", data, None)

    dune, other = out["titles"]
    assert dune["poster_url"] == "https://img/dune.jpg"
    assert dune["providers"][0]["name"] == "Netflix"
    assert dune["providers_region"] == "IN"
    assert other == {"title": "Obscure Short", "why": "hidden gem"}  # miss = untouched
    assert cover == "https://img/dune.jpg"  # first poster offered as cover


async def test_cover_not_overridden_when_note_already_has_one(monkeypatch):
    async def fake_search(title, year=None, media_hint=None):
        return TmdbHit(tmdb_id=1, media_type="movie", title="Dune",
                       poster_url="https://img/dune.jpg")

    async def fake_providers(tmdb_id, media_type, region):
        return []

    monkeypatch.setattr(enrich.tmdb, "search_title", fake_search)
    monkeypatch.setattr(enrich.tmdb, "watch_providers", fake_providers)

    _, cover = await enrich.enrich_note_data(
        "u", "movie", {"titles": [{"title": "Dune"}]}, "https://og-image.jpg")
    assert cover is None  # real source imagery always wins


async def test_shopping_price_parsed_into_amount_and_currency():
    data = {"price": "₹2,499", "brand": "Sony"}
    out, cover = await enrich.enrich_note_data("u", "product", data, None)
    assert out["price_amount"] == 2499.0
    assert out["currency"] == "₹"
    assert cover is None


async def test_enrichment_failure_leaves_note_valid(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("tmdb down")
    monkeypatch.setattr(enrich.tmdb, "search_title", boom)

    data = {"titles": [{"title": "Dune"}]}
    out, cover = await enrich.enrich_note_data("u", "movie", data, None)
    assert out["titles"] == [{"title": "Dune"}]  # untouched, never raises
    assert cover is None


async def test_unmatched_family_is_a_no_op():
    data = {"tldr": "an essay"}
    out, cover = await enrich.enrich_note_data("u", "article", dict(data), None)
    assert out == data
    assert cover is None


# --- city normalization (pure) --------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("Bangalore", "Bengaluru"),
    ("bangalore", "Bengaluru"),   # case-insensitive
    (" Bangalore ", "Bengaluru"),  # trimmed before lookup
    ("Bombay", "Mumbai"),
    ("Madras", "Chennai"),
    ("Calcutta", "Kolkata"),
    ("Gurgaon", "Gurugram"),
    ("Bengaluru", "Bengaluru"),  # already canonical -> unchanged
    ("Goa", "Goa"),              # no alias -> passthrough as-is
    ("", None),
    (None, None),
    (123, None),                 # non-string input never raises
])
def test_normalize_city_aliases(raw, expected):
    assert enrich.normalize_city(raw) == expected


async def test_place_venue_prefers_places_locality_over_source_city(monkeypatch):
    from services.google_places import PlaceHit

    async def fake_search(name, location=None, region=None):
        return PlaceHit(place_id="p1", name="Blue Tokai")

    async def fake_details(place_id):
        return {"place_id": "p1", "name": "Blue Tokai", "locality": "Bengaluru",
                "photo_url": "https://lh3/p1.jpg"}

    monkeypatch.setattr(enrich.google_places, "search_place", fake_search)
    monkeypatch.setattr(enrich.google_places, "place_details", fake_details)

    data = {"venues": [{"name": "Blue Tokai", "city": "Bangalore"}]}
    out, _ = await enrich.enrich_note_data("u", "place", data, None)
    assert out["venues"][0]["city"] == "Bengaluru"  # Places locality wins over source text


async def test_place_venue_falls_back_to_alias_map_without_a_places_match(monkeypatch):
    async def fake_search(name, location=None, region=None):
        return None  # no Google match at all

    monkeypatch.setattr(enrich.google_places, "search_place", fake_search)

    data = {"venues": [{"name": "Hidden Gem", "city": "Bangalore"}]}
    out, _ = await enrich.enrich_note_data("u", "place", data, None)
    assert out["venues"][0]["city"] == "Bengaluru"  # alias map alone still normalizes
