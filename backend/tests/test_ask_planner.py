"""Unit tests for the plan→retrieval helpers: tz-aware period bounds, type matching,
and the dated candidate index. No DB or Gemini — pure deterministic logic."""
from datetime import datetime, timedelta, timezone

import routers.ask as ask_mod

IST = 330  # minutes east of UTC (Asia/Kolkata, +5:30)
UTC = timezone.utc


def _utc(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def test_today_bounds_use_local_day_not_utc():
    # 18:00 UTC on the 14th = 23:30 IST on the 14th — still "today" for the user.
    now = _utc(2026, 6, 14, 18, 0)
    after, before = ask_mod._period_bounds("today", IST, now)
    # Local midnight (14th 00:00 IST) → 13th 18:30 UTC.
    assert after == _utc(2026, 6, 13, 18, 30)
    assert before == now
    # A save at 17:00 UTC (22:30 IST on the 14th) falls inside today's window.
    assert after <= _utc(2026, 6, 14, 17, 0) < before


def test_late_local_save_lands_in_today():
    # 18:30 UTC = 00:00 IST on the 15th: the user's "today" has rolled over.
    now = _utc(2026, 6, 14, 18, 30)
    after, _ = ask_mod._period_bounds("today", IST, now)
    assert after == _utc(2026, 6, 14, 18, 30)  # local 15th 00:00 → UTC 14th 18:30


def test_yesterday_bounds():
    now = _utc(2026, 6, 14, 18, 0)
    after, before = ask_mod._period_bounds("yesterday", IST, now)
    assert after == _utc(2026, 6, 12, 18, 30)   # 13th 00:00 IST
    assert before == _utc(2026, 6, 13, 18, 30)  # 14th 00:00 IST


def test_recent_is_rolling_seven_days():
    now = _utc(2026, 6, 14, 12, 0)
    after, before = ask_mod._period_bounds("recent", IST, now)
    assert before == now
    assert after == now - timedelta(days=7)


def test_this_week_starts_monday_local():
    # 2026-06-14 is a Sunday; local Monday is 2026-06-08.
    now = _utc(2026, 6, 14, 5, 0)  # 10:30 IST Sunday
    after, before = ask_mod._period_bounds("this_week", IST, now)
    assert after == _utc(2026, 6, 7, 18, 30)  # Mon 8th 00:00 IST → 7th 18:30 UTC
    assert before == now


def test_unknown_period_returns_none():
    assert ask_mod._period_bounds("eon", IST, _utc(2026, 6, 14)) is None


def test_type_variants_handle_plural_and_case():
    v = ask_mod._type_variants(["Recipes"])
    assert "recipe" in v and "recipes" in v


def test_filter_types_matches_normalized():
    notes = [{"content_type": "recipe"}, {"content_type": "movie"}]
    assert ask_mod._filter_types(notes, ["recipes"]) == [{"content_type": "recipe"}]
    assert ask_mod._filter_types(notes, []) == notes  # no filter → passthrough


def test_dated_index_renders_local_saved_date():
    created = _utc(2026, 6, 13, 20, 0)  # 01:30 IST on the 14th
    index = ask_mod._dated_index(
        [{"id": "n1", "content_type": "recipe", "title": "T", "ai_summary": "S", "created_at": created}],
        IST,
    )
    assert index[0]["saved"] == "2026-06-14"
    assert index[0]["type"] == "recipe"
