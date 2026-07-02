"""reserve_backfill_run: per-user, per-app daily budget on mini-app backfills (their
writes are idempotent, but each run re-incurs Gemini / enrichment-API spend)."""
from datetime import datetime, timezone

import pytest

import services.firebase as fb
from config import settings

TODAY = datetime.now(timezone.utc).strftime("%Y%m%d")


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(fb, "get_db", lambda: fake_db)
    monkeypatch.setattr(settings, "MAX_BACKFILLS_PER_APP_PER_DAY", 2)
    return fake_db


async def test_runs_allowed_until_the_daily_cap(fake_db):
    assert await fb.reserve_backfill_run("u", "trips") is True
    assert await fb.reserve_backfill_run("u", "trips") is True
    assert await fb.reserve_backfill_run("u", "trips") is False  # third run today: rejected
    assert fake_db.docs[("usage", f"u-{TODAY}")]["backfill_trips_count"] == 2


async def test_budget_is_per_app_and_per_user(fake_db):
    assert await fb.reserve_backfill_run("u", "trips") is True
    assert await fb.reserve_backfill_run("u", "trips") is True
    assert await fb.reserve_backfill_run("u", "trips") is False
    # A different app and a different user each have their own budget.
    assert await fb.reserve_backfill_run("u", "watchlist") is True
    assert await fb.reserve_backfill_run("u2", "trips") is True
