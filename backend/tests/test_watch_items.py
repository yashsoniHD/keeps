"""PATCH/DELETE /watch-items/{id}: ownership scoping, watched_at stamping, rating clamp."""
import pytest
from fastapi import HTTPException

import routers.watch_items as wi_mod

COL = "users/u/watch_items"


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(wi_mod, "get_db", lambda: fake_db)
    return fake_db


async def test_mark_watched_stamps_watched_at(fake_db):
    fake_db.seed(COL, "m_1", {"user_id": "u", "watch_status": "to_watch", "watched_at": None})
    res = await wi_mod.update_watch_item("m_1", wi_mod.WatchItemUpdate(watch_status="watched"), user_id="u")
    assert res == {"ok": True}
    doc = fake_db.docs[(COL, "m_1")]
    assert doc["watch_status"] == "watched"
    assert doc["watched_at"] is not None


async def test_mark_to_watch_clears_watched_at(fake_db):
    fake_db.seed(COL, "m_1", {"user_id": "u", "watch_status": "watched", "watched_at": "x"})
    await wi_mod.update_watch_item("m_1", wi_mod.WatchItemUpdate(watch_status="to_watch"), user_id="u")
    assert fake_db.docs[(COL, "m_1")]["watched_at"] is None


async def test_promote_saved_to_watchlist(fake_db):
    """Promoting a Saved (inbox) item flips it to the watchlist without stamping watched_at."""
    fake_db.seed(COL, "m_1", {"user_id": "u", "watch_status": "saved", "watched_at": None})
    await wi_mod.update_watch_item("m_1", wi_mod.WatchItemUpdate(watch_status="to_watch"), user_id="u")
    doc = fake_db.docs[(COL, "m_1")]
    assert doc["watch_status"] == "to_watch"
    assert doc["watched_at"] is None


def test_saved_status_accepted():
    """The PATCH validator accepts the `saved` bucket (e.g. demoting back to the inbox)."""
    assert wi_mod.WatchItemUpdate(watch_status="saved").watch_status == "saved"


def test_watching_status_accepted():
    """The retired in-progress `watching` status stays a valid write: older docs may still
    hold it (the UI maps them onto the watchlist bucket and no longer offers the transition)."""
    assert wi_mod.WatchItemUpdate(watch_status="watching").watch_status == "watching"


async def test_start_watching_does_not_stamp_watched_at(fake_db):
    fake_db.seed(COL, "t_1", {"user_id": "u", "watch_status": "to_watch", "watched_at": None})
    await wi_mod.update_watch_item("t_1", wi_mod.WatchItemUpdate(watch_status="watching"), user_id="u")
    doc = fake_db.docs[(COL, "t_1")]
    assert doc["watch_status"] == "watching"
    assert doc["watched_at"] is None


async def test_toggle_favorite(fake_db):
    fake_db.seed(COL, "m_1", {"user_id": "u", "watch_status": "saved", "favorite": False})
    await wi_mod.update_watch_item("m_1", wi_mod.WatchItemUpdate(favorite=True), user_id="u")
    assert fake_db.docs[(COL, "m_1")]["favorite"] is True


def test_bad_status_rejected():
    with pytest.raises(Exception):  # pydantic pattern ^(saved|to_watch|watching|watched)$
        wi_mod.WatchItemUpdate(watch_status="archived")


async def test_set_rating(fake_db):
    fake_db.seed(COL, "m_1", {"user_id": "u", "watch_status": "watched"})
    await wi_mod.update_watch_item("m_1", wi_mod.WatchItemUpdate(rating=4), user_id="u")
    assert fake_db.docs[(COL, "m_1")]["rating"] == 4


def test_rating_out_of_range_rejected():
    with pytest.raises(Exception):  # pydantic ValidationError (ge=1, le=5)
        wi_mod.WatchItemUpdate(rating=6)


async def test_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await wi_mod.update_watch_item("nope", wi_mod.WatchItemUpdate(rating=3), user_id="u")
    assert exc.value.status_code == 404


async def test_non_owner_cannot_touch_anothers_item(fake_db):
    """Items are path-scoped by uid, so another user's PATCH lands on an empty path → 404,
    and the owner's doc is untouched."""
    fake_db.seed(COL, "m_1", {"user_id": "u", "watch_status": "to_watch"})
    with pytest.raises(HTTPException) as exc:
        await wi_mod.update_watch_item("m_1", wi_mod.WatchItemUpdate(watch_status="watched"), user_id="intruder")
    assert exc.value.status_code == 404
    assert fake_db.docs[(COL, "m_1")]["watch_status"] == "to_watch"


async def test_delete_item(fake_db):
    fake_db.seed(COL, "m_1", {"user_id": "u"})
    await wi_mod.delete_watch_item("m_1", user_id="u")
    assert (COL, "m_1") not in fake_db.docs


async def test_search_titles_returns_results(monkeypatch):
    async def fake_search(q, limit=12):
        return [{"tmdb_id": 27205, "media_type": "movie", "title": "Inception"}]
    monkeypatch.setattr(wi_mod.tmdb, "search", fake_search)
    res = await wi_mod.search_titles("inception", user_id="u")
    assert res == {"results": [{"tmdb_id": 27205, "media_type": "movie", "title": "Inception"}]}


async def test_create_watch_item(monkeypatch):
    async def fake_add(uid, tmdb_id, media_type, region=None):
        assert (uid, tmdb_id, media_type) == ("u", 27205, "movie")
        return "m_27205"
    monkeypatch.setattr(wi_mod, "add_by_tmdb", fake_add)
    res = await wi_mod.create_watch_item(
        wi_mod.WatchItemCreate(tmdb_id=27205, media_type="movie"), user_id="u")
    assert res == {"id": "m_27205"}


async def test_create_watch_item_bad_tmdb_400(monkeypatch):
    async def fake_add(uid, tmdb_id, media_type, region=None):
        raise ValueError("Title not found on TMDB.")
    monkeypatch.setattr(wi_mod, "add_by_tmdb", fake_add)
    with pytest.raises(HTTPException) as exc:
        await wi_mod.create_watch_item(
            wi_mod.WatchItemCreate(tmdb_id=1, media_type="tv"), user_id="u")
    assert exc.value.status_code == 400


def test_create_rejects_bad_media_type():
    with pytest.raises(Exception):  # pydantic pattern ^(movie|tv)$
        wi_mod.WatchItemCreate(tmdb_id=1, media_type="book")


async def test_details_returns_tmdb_payload(fake_db, monkeypatch):
    fake_db.seed(COL, "m_27205", {"user_id": "u", "tmdb_id": 27205, "media_type": "movie"})
    async def fake_details(tmdb_id, media_type):
        return {"tmdb_id": tmdb_id, "runtime": 148}
    monkeypatch.setattr(wi_mod.tmdb, "details", fake_details)
    res = await wi_mod.watch_item_details("m_27205", user_id="u")
    assert res == {"tmdb_id": 27205, "runtime": 148}


async def test_details_empty_when_no_tmdb_id(fake_db):
    fake_db.seed(COL, "raw_x", {"user_id": "u", "media_type": "unknown"})
    assert await wi_mod.watch_item_details("raw_x", user_id="u") == {}


async def test_details_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await wi_mod.watch_item_details("nope", user_id="u")
    assert exc.value.status_code == 404
