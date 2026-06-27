"""TMDB service: pure best-hit selection + provider parsing (no live API)."""
import pytest

from services import tmdb


def test_image_url():
    assert tmdb.image_url("/poster.jpg", "w500") == "https://image.tmdb.org/t/p/w500/poster.jpg"
    assert tmdb.image_url(None) is None


def test_best_hit_prefers_exact_title_and_year():
    results = [
        {"media_type": "movie", "id": 2, "title": "Inception: The Cobol Job",
         "release_date": "2010-01-01", "popularity": 90.0},
        {"media_type": "movie", "id": 1, "title": "Inception",
         "release_date": "2010-07-16", "popularity": 50.0},
    ]
    best = tmdb._best_hit(results, "Inception", "2010", "movie")
    assert best["id"] == 1  # exact title + year beats a partial match with higher popularity


def test_best_hit_uses_media_hint_to_disambiguate():
    results = [
        {"media_type": "movie", "id": 10, "title": "Fargo", "release_date": "1996-03-08",
         "popularity": 30.0},
        {"media_type": "tv", "id": 11, "name": "Fargo", "first_air_date": "2014-04-15",
         "popularity": 40.0},
    ]
    assert tmdb._best_hit(results, "Fargo", None, "tv")["id"] == 11
    assert tmdb._best_hit(results, "Fargo", None, "movie")["id"] == 10


def test_best_hit_returns_none_on_weak_match():
    results = [{"media_type": "movie", "id": 99, "title": "Completely Different",
               "release_date": "2000", "popularity": 100.0}]
    assert tmdb._best_hit(results, "Inception", None, "movie") is None


def test_best_hit_ignores_non_title_media():
    results = [{"media_type": "person", "id": 5, "name": "Inception", "popularity": 100.0}]
    assert tmdb._best_hit(results, "Inception", None, None) is None


def test_hit_from_result_maps_fields():
    r = {"media_type": "movie", "id": 27205, "title": "Inception",
         "release_date": "2010-07-16", "poster_path": "/p.jpg", "backdrop_path": "/b.jpg",
         "overview": "A thief...", "genre_ids": [28, 878]}
    hit = tmdb._hit_from_result(r, {28: "Action", 878: "Science Fiction"})
    assert hit.tmdb_id == 27205
    assert hit.media_type == "movie"
    assert hit.year == "2010"
    assert hit.poster_url == "https://image.tmdb.org/t/p/w500/p.jpg"
    assert hit.genres == ["Action", "Science Fiction"]


def test_parse_providers_flatrate_first_and_deduped():
    data = {"results": {"IN": {
        "flatrate": [{"provider_name": "Netflix", "logo_path": "/n.jpg"}],
        "rent": [{"provider_name": "Apple TV", "logo_path": "/a.jpg"}],
        "buy": [{"provider_name": "Netflix"}],  # dup of the flatrate entry
    }}}
    out = tmdb._parse_providers(data, "IN")
    assert [p["name"] for p in out] == ["Netflix", "Apple TV"]
    assert out[0]["type"] == "flatrate"
    assert out[0]["logo_url"] == "https://image.tmdb.org/t/p/w92/n.jpg"


def test_parse_providers_missing_region_is_empty():
    assert tmdb._parse_providers({"results": {"IN": {}}}, "US") == []


async def test_search_title_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(tmdb.settings, "TMDB_BEARER", "")
    assert await tmdb.search_title("Inception", "2010", "movie") is None
    assert await tmdb.watch_providers(27205, "movie", "IN") == []
