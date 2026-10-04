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
