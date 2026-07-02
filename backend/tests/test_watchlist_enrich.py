"""Watchlist enrichment: titles → watch_items (dedup, no-clobber of user state)."""
import pytest

import services.watchlist as wl
from services import tmdb
from services.tmdb import TmdbHit

COL = "users/u/watch_items"


def _hit(tmdb_id, title, media_type="movie", year="2010"):
    return TmdbHit(tmdb_id=tmdb_id, media_type=media_type, title=title, year=year,
                   poster_url=f"https://img/{tmdb_id}.jpg", overview="o", genres=["Drama"])


@pytest.fixture(autouse=True)
def patch_deps(fake_db, monkeypatch):
    monkeypatch.setattr(wl, "get_db", lambda: fake_db)

    catalog = {
        "Inception": _hit(1, "Inception"),
        "Arrival": _hit(2, "Arrival", year="2016"),
        "Fargo": _hit(3, "Fargo", media_type="tv", year="2014"),
    }

    async def fake_search(title, year=None, media_hint=None):
        return catalog.get(title)

    async def fake_providers(tmdb_id, media_type, region):
        return [{"name": "Netflix", "logo_url": None, "type": "flatrate"}]

    monkeypatch.setattr(tmdb, "search_title", fake_search)
    monkeypatch.setattr(tmdb, "watch_providers", fake_providers)
    return fake_db


async def test_list_fans_out_into_one_item_per_title(fake_db):
    titles = [
        {"title": "Inception", "year": "2010", "mediaType": "movie"},
        {"title": "Arrival", "mediaType": "movie"},
        {"title": "Fargo", "mediaType": "tv"},
    ]
    item_ids = await wl.enrich_titles("u", "note-1", titles, region="IN")

    assert (COL, "m_1") in fake_db.docs
    assert (COL, "m_2") in fake_db.docs
    assert (COL, "t_3") in fake_db.docs  # tv keys on the "t_" prefix
    item = fake_db.docs[(COL, "m_1")]
    assert item["watch_status"] == "saved"  # note-extracted titles start in the Saved inbox
    assert item["rating"] is None
    assert item["media_type"] == "movie"
    assert item["providers"][0]["name"] == "Netflix"
    assert item["created_at"] is not None
    assert item_ids == ["m_1", "m_2", "t_3"]  # produced item ids, for destination routing


async def test_unmatched_title_still_creates_a_raw_item(fake_db):
    item_ids = await wl.enrich_titles("u", "note-1",
                                      [{"title": "Some Indie Film", "year": "2021"}], region="IN")
    # No TMDB match → keyed on a raw title|year id, with the raw title preserved.
    raw = [k for k in fake_db.docs if k[0] == COL and k[1].startswith("raw_")]
    assert raw, "an unmatched title should still produce a trackable item"
    assert item_ids == [raw[0][1]]


async def test_resave_does_not_clobber_user_state(fake_db):
    """A film already marked watched + rated must keep that state when its note is re-saved."""
    fake_db.seed(COL, "m_1", {
        "user_id": "u", "watch_status": "watched", "rating": 5, "watched_at": "earlier",
        "poster_url": "https://img/old.jpg",
    })
    await wl.enrich_titles("u", "note-2", [{"title": "Inception", "mediaType": "movie"}], region="IN")

    item = fake_db.docs[(COL, "m_1")]
    assert item["watch_status"] == "watched"  # preserved
    assert item["rating"] == 5                # preserved
    assert item["watched_at"] == "earlier"    # preserved
    assert item["poster_url"] == "https://img/1.jpg"  # enrichment refreshed


async def test_empty_titles_is_noop(fake_db):
    assert await wl.enrich_titles("u", "note-1", [], region="IN") == []
    assert not any(k[0] == COL for k in fake_db.docs)


async def test_add_by_tmdb_creates_enriched_item(fake_db, monkeypatch):
    async def fake_details(tmdb_id, media_type):
        return {"title": "Inception", "year": "2010", "poster_url": "https://img/1.jpg",
                "backdrop_url": "https://img/b.jpg", "overview": "o", "genres": ["Sci-Fi"]}
    monkeypatch.setattr(tmdb, "details", fake_details)

    doc_id = await wl.add_by_tmdb("u", 27205, "movie", region="IN")
    assert doc_id == "m_27205"
    item = fake_db.docs[(COL, "m_27205")]
    assert item["title"] == "Inception"
    assert item["tmdb_id"] == 27205
    assert item["added_manually"] is True
    assert item["watch_status"] == "to_watch"  # manual adds skip the inbox, land on the watchlist
    assert item["providers"][0]["name"] == "Netflix"


async def test_add_by_tmdb_does_not_clobber_existing_state(fake_db, monkeypatch):
    fake_db.seed(COL, "m_27205", {"user_id": "u", "watch_status": "watched", "rating": 4})
    async def fake_details(tmdb_id, media_type):
        return {"title": "Inception", "year": "2010", "poster_url": "https://img/1.jpg"}
    monkeypatch.setattr(tmdb, "details", fake_details)

    await wl.add_by_tmdb("u", 27205, "movie", region="IN")
    item = fake_db.docs[(COL, "m_27205")]
    assert item["watch_status"] == "watched"  # preserved
    assert item["rating"] == 4                # preserved


async def test_add_by_tmdb_raises_on_tmdb_miss(fake_db, monkeypatch):
    async def fake_details(tmdb_id, media_type):
        return None
    monkeypatch.setattr(tmdb, "details", fake_details)
    with pytest.raises(ValueError):
        await wl.add_by_tmdb("u", 999, "movie", region="IN")


async def test_get_user_region_default_and_override(fake_db, monkeypatch):
    monkeypatch.setattr(wl, "get_db", lambda: fake_db)
    assert await wl.get_user_region("u") == wl.settings.DEFAULT_WATCH_REGION
    fake_db.seed("users", "u", {"region": "gb"})
    assert await wl.get_user_region("u") == "GB"
