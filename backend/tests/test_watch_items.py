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
