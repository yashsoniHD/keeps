"""PATCH/DELETE /trip-items/{id}: ownership scoping, favorite toggle."""
import pytest
from fastapi import HTTPException

import routers.trip_items as ti_mod

COL = "users/u/trip_items"


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(ti_mod, "get_db", lambda: fake_db)
    return fake_db


async def test_toggle_favorite(fake_db):
    fake_db.seed(COL, "t_1", {"user_id": "u", "favorite": False})
    res = await ti_mod.update_trip_item("t_1", ti_mod.TripItemUpdate(favorite=True), user_id="u")
    assert res == {"ok": True}
    assert fake_db.docs[(COL, "t_1")]["favorite"] is True
    await ti_mod.update_trip_item("t_1", ti_mod.TripItemUpdate(favorite=False), user_id="u")
    assert fake_db.docs[(COL, "t_1")]["favorite"] is False


async def test_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await ti_mod.update_trip_item("nope", ti_mod.TripItemUpdate(favorite=True), user_id="u")
    assert exc.value.status_code == 404


async def test_non_owner_cannot_touch_anothers_item(fake_db):
    fake_db.seed(COL, "t_1", {"user_id": "u", "favorite": False})
    with pytest.raises(HTTPException) as exc:
        await ti_mod.update_trip_item("t_1", ti_mod.TripItemUpdate(favorite=True), user_id="intruder")
    assert exc.value.status_code == 404
    assert fake_db.docs[(COL, "t_1")]["favorite"] is False  # untouched


async def test_delete_item(fake_db):
    fake_db.seed(COL, "t_1", {"user_id": "u"})
    await ti_mod.delete_trip_item("t_1", user_id="u")
    assert (COL, "t_1") not in fake_db.docs


async def test_delete_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await ti_mod.delete_trip_item("nope", user_id="u")
    assert exc.value.status_code == 404


async def test_backfill_delegates_to_service(monkeypatch):
    async def fake_backfill(uid):
        assert uid == "u"
        return {"notes_processed": 3, "trips_found": 3}
    monkeypatch.setattr(ti_mod, "backfill_user", fake_backfill)
    assert await ti_mod.backfill_trip_items(user_id="u") == {"notes_processed": 3, "trips_found": 3}
