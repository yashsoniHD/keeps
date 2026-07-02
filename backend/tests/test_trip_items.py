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


def _stub_backfill_plumbing(monkeypatch, *, run_allowed=True):
    """Stub the cap/meter plumbing around the backfill endpoint (unit-tested separately)."""
    async def fake_reserve(uid, app):
        assert app == "trips"
        return run_allowed
    monkeypatch.setattr(ti_mod, "reserve_backfill_run", fake_reserve)
    monkeypatch.setattr(ti_mod, "start_metering", lambda: object())

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(ti_mod, "flush_usage", fake_flush)


async def test_backfill_delegates_to_service(monkeypatch):
    _stub_backfill_plumbing(monkeypatch)

    async def fake_backfill(uid):
        assert uid == "u"
        return {"notes_processed": 3, "trips_found": 3}
    monkeypatch.setattr(ti_mod, "backfill_user", fake_backfill)
    assert await ti_mod.backfill_trip_items(user_id="u") == {"notes_processed": 3, "trips_found": 3}


async def test_backfill_metered_and_capped(monkeypatch):
    """The trip backfill makes real Gemini calls (day-plan re-extraction) — it must run
    inside a usage meter and respect the daily run cap."""
    flushed = []
    sentinel = object()

    async def fake_reserve(uid, app):
        return True
    monkeypatch.setattr(ti_mod, "reserve_backfill_run", fake_reserve)
    monkeypatch.setattr(ti_mod, "start_metering", lambda: sentinel)

    async def fake_flush(uid, meter):
        flushed.append((uid, meter))
    monkeypatch.setattr(ti_mod, "flush_usage", fake_flush)

    async def fake_backfill(uid):
        return {"notes_processed": 1, "trips_found": 1}
    monkeypatch.setattr(ti_mod, "backfill_user", fake_backfill)

    await ti_mod.backfill_trip_items(user_id="u")
    assert flushed == [("u", sentinel)]  # spend attributed even though backfill succeeded


async def test_backfill_cap_hit_is_429(monkeypatch):
    _stub_backfill_plumbing(monkeypatch, run_allowed=False)

    async def fake_backfill(uid):  # must never run once the cap rejects
        raise AssertionError("backfill ran past the cap")
    monkeypatch.setattr(ti_mod, "backfill_user", fake_backfill)

    with pytest.raises(HTTPException) as exc:
        await ti_mod.backfill_trip_items(user_id="u")
    assert exc.value.status_code == 429
