"""Tests for the in-app personal digest (POST /api/digest/me): a cached, composed week-in-review
per user (intro + optional qualitative facts + theme sections that synthesize the fed notes into
second-person prose, each deep-linking to source notes) plus pure-Python stats over the fed set.

The narrative is built by Gemini from the fed note set and cached on `users/{uid}.digest`, keyed by
a signature of the fed note ids so an unchanged week never re-triggers a paid rebuild. Stats are
recomputed fresh on every call (never modeled), so the numbers are always right regardless of digest
cache state; a digest miss (empty week, cap exhausted, build failure) never 429s/500s.

Router-level tests call `my_digest` directly, bypassing FastAPI's Depends — same pattern as
test_collection_digest.py. The Gemini-level item/id filtering is tested directly against a faked
Gemini client response (shared `_run_digest`), mirroring test_collection_digest.py.
"""
import json as _json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import routers.digest as dig
from config import settings
from models.ask import CollectionDigest, DigestEntry, DigestSection

NOW = datetime.now(timezone.utc)


def _seed_note(fake_db, note_id, *, days_ago, content_type="note", domain="example.com"):
    fake_db.seed("notes", note_id, {
        "user_id": "u", "title": f"Note {note_id}", "content_type": content_type,
        "ai_summary": "summary", "source_domain": domain,
        "created_at": NOW - timedelta(days=days_ago), "data": {},
    })


def _wire(monkeypatch, fake_db, *, reserve=True, build=None):
    """Wire get_db + reserve_personal_digest (429/stale check) + gemini build (rebuild path) +
    flush_usage (no-op — a real flush would hit the live Firestore singleton)."""
    monkeypatch.setattr(dig, "get_db", lambda: fake_db)

    async def fake_reserve(uid):
        return reserve
    monkeypatch.setattr(dig, "reserve_personal_digest", fake_reserve)

    if build is not None:
        monkeypatch.setattr(dig.gemini_service, "build_personal_digest", build)

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(dig, "flush_usage", fake_flush)


async def _no_reserve_call(uid):
    raise AssertionError("reserve_personal_digest should not be called")


async def _no_build_call(*a, **k):
    raise AssertionError("build_personal_digest should not be called")


# --- empty corpus ----------------------------------------------------------------------------

async def test_zero_notes_returns_nulls_no_reserve_no_build(fake_db, monkeypatch):
    monkeypatch.setattr(dig, "get_db", lambda: fake_db)
    monkeypatch.setattr(dig, "reserve_personal_digest", _no_reserve_call)
    monkeypatch.setattr(dig.gemini_service, "build_personal_digest", _no_build_call)

    result = await dig.my_digest(user_id="u")
    assert result == {"digest": None, "stats": None, "note_refs": [], "stale": False}


# --- week fed set + stats --------------------------------------------------------------------

async def test_week_notes_build_over_week_with_correct_stats(fake_db, monkeypatch):
    captured = {}

    async def fake_build(display_name, window_label, notes):
        captured["notes"] = notes
        captured["window_label"] = window_label
        return CollectionDigest(intro="Your week")

    _wire(monkeypatch, fake_db, build=fake_build)
    # 3 saves on the same recent day, 1 each on two other recent days — all within 7 days.
    _seed_note(fake_db, "n1", days_ago=1, content_type="recipe", domain="youtube.com")
    _seed_note(fake_db, "n2", days_ago=1, content_type="recipe", domain="youtube.com")
    _seed_note(fake_db, "n3", days_ago=1, content_type="recipe", domain="youtube.com")
    _seed_note(fake_db, "n4", days_ago=2, content_type="article", domain="blog.com")
    _seed_note(fake_db, "n5", days_ago=3, content_type="product", domain="shop.com")
    fake_db.seed("users", "u", {"display_name": "Yash"})

    result = await dig.my_digest(user_id="u")

    fed_ids = {n["id"] for n in captured["notes"]}
    assert fed_ids == {"n1", "n2", "n3", "n4", "n5"}

    stats = result["stats"]
    assert stats["total"] == 5
    assert stats["fallback"] is False
    assert stats["window_days"] == 7
    assert stats["window_end"] == NOW.date().isoformat()
    assert stats["window_start"] == (NOW - timedelta(days=7)).date().isoformat()
    assert stats["categories"] == [
        {"slug": "recipe", "count": 3},
        {"slug": "article", "count": 1},
        {"slug": "product", "count": 1},
    ]
    assert stats["top_domains"][0] == {"domain": "youtube.com", "count": 3}
    assert stats["active_days"] == 3
    assert stats["busiest_day"] == {
        "label": (NOW - timedelta(days=1)).strftime("%A"), "count": 3}

    assert len(result["note_refs"]) == 5
    assert result["stale"] is False
    assert result["digest"]["fallback"] is False


# --- sparse week → fallback ------------------------------------------------------------------

async def test_sparse_week_falls_back_to_newest_notes(fake_db, monkeypatch):
    async def fake_build(display_name, window_label, notes):
        return CollectionDigest(intro="Your latest")

    _wire(monkeypatch, fake_db, build=fake_build)
    # Only 2 in the last 7 days (< MY_DIGEST_MIN_WEEK_NOTES=3), plus 2 older.
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=10)
    _seed_note(fake_db, "n4", days_ago=20)

    result = await dig.my_digest(user_id="u")

    stats = result["stats"]
    assert stats["fallback"] is True
    assert stats["total"] == 4
    # Span from oldest (20d ago) to newest (1d ago) fed date, inclusive.
    assert stats["window_days"] == 20
    assert stats["window_start"] == (NOW - timedelta(days=20)).date().isoformat()
    assert stats["window_end"] == (NOW - timedelta(days=1)).date().isoformat()
    assert stats["active_days"] == 4
    assert result["digest"]["fallback"] is True


async def test_fallback_caps_at_fallback_notes(fake_db, monkeypatch):
    captured = {}

    async def fake_build(display_name, window_label, notes):
        captured["notes"] = notes
        return CollectionDigest(intro="x")

    _wire(monkeypatch, fake_db, build=fake_build)
    # No notes in the last 7 days at all — a sparse week that falls back to the newest N.
    total = settings.MY_DIGEST_FALLBACK_NOTES + 4
    for i in range(total):
        _seed_note(fake_db, f"n{i}", days_ago=10 + i)  # all older than 7 days, ascending age

    result = await dig.my_digest(user_id="u")

    assert result["stats"]["fallback"] is True
    assert len(captured["notes"]) == settings.MY_DIGEST_FALLBACK_NOTES
    fed_ids = {n["id"] for n in captured["notes"]}
    newest_ids = {f"n{i}" for i in range(settings.MY_DIGEST_FALLBACK_NOTES)}  # smallest days_ago
    assert fed_ids == newest_ids


# --- signature match: cached, no rebuild -----------------------------------------------------

async def test_signature_match_returns_cached_zero_build_zero_reserve(fake_db, monkeypatch):
    monkeypatch.setattr(dig, "get_db", lambda: fake_db)
    monkeypatch.setattr(dig, "reserve_personal_digest", _no_reserve_call)
    monkeypatch.setattr(dig.gemini_service, "build_personal_digest", _no_build_call)

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(dig, "flush_usage", fake_flush)

    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)
    stored = {
        "intro": "cached intro", "facts": [], "sections": [],
        "source_note_ids": ["n1", "n2", "n3"],
        "prompt_version": settings.PERSONAL_DIGEST_PROMPT_VERSION, "fallback": False,
    }
    fake_db.seed("users", "u", {"display_name": "Yash", "digest": stored})

    result = await dig.my_digest(user_id="u")

    assert result["digest"] == stored
    assert result["stale"] is False
    # Stats are still computed fresh even on a cache hit.
    assert result["stats"]["total"] == 3
    assert len(result["note_refs"]) == 3


async def test_force_rebuilds_despite_matching_signature(fake_db, monkeypatch):
    calls = []

    async def fake_build(display_name, window_label, notes):
        calls.append(1)
        return CollectionDigest(intro="fresh")

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)
    stored = {
        "intro": "cached", "facts": [], "sections": [],
        "source_note_ids": ["n1", "n2", "n3"],
        "prompt_version": settings.PERSONAL_DIGEST_PROMPT_VERSION,
    }
    fake_db.seed("users", "u", {"digest": stored})

    result = await dig.my_digest(body=dig.MyDigestRequest(force=True), user_id="u")

    assert len(calls) == 1
    assert result["digest"]["intro"] == "fresh"


async def test_stale_prompt_version_triggers_rebuild(fake_db, monkeypatch):
    calls = []

    async def fake_build(display_name, window_label, notes):
        calls.append(1)
        return CollectionDigest(intro="rebuilt under new prompt")

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)
    stored = {
        "intro": "old", "facts": [], "sections": [],
        "source_note_ids": ["n1", "n2", "n3"],
        "prompt_version": settings.PERSONAL_DIGEST_PROMPT_VERSION - 1,
    }
    fake_db.seed("users", "u", {"digest": stored})

    result = await dig.my_digest(user_id="u")

    assert len(calls) == 1
    assert result["digest"]["intro"] == "rebuilt under new prompt"
    assert result["digest"]["prompt_version"] == settings.PERSONAL_DIGEST_PROMPT_VERSION


# --- cap exhausted / build failure -----------------------------------------------------------

async def test_reserve_false_with_cache_returns_stale(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, reserve=False, build=_no_build_call)
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)
    stored = {"intro": "old", "facts": [], "sections": [], "source_note_ids": ["different"]}
    fake_db.seed("users", "u", {"digest": stored})

    result = await dig.my_digest(user_id="u")

    assert result["digest"] == stored
    assert result["stale"] is True
    assert result["stats"]["total"] == 3  # stats still present


async def test_reserve_false_no_cache_returns_null_stale_with_stats(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, reserve=False, build=_no_build_call)
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)

    result = await dig.my_digest(user_id="u")

    assert result["digest"] is None
    assert result["stale"] is True
    assert result["stats"]["total"] == 3
    assert len(result["note_refs"]) == 3


async def test_build_none_returns_stale_not_500(fake_db, monkeypatch):
    async def fake_build(display_name, window_label, notes):
        return None

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)
    stored = {"intro": "old", "facts": [], "sections": [], "source_note_ids": ["different"]}
    fake_db.seed("users", "u", {"digest": stored})

    result = await dig.my_digest(user_id="u")

    assert result["digest"] == stored
    assert result["stale"] is True
    assert result["stats"]["total"] == 3


# --- section grounding: filter foreign source_note_ids, drop empty sections -------------------

async def test_router_filters_source_note_ids_and_drops_empty_sections(fake_db, monkeypatch):
    async def fake_build(display_name, window_label, notes):
        return CollectionDigest(
            intro="digest",
            sections=[
                DigestSection(heading="Real", body="A synthesis paragraph.",
                              source_note_ids=["n1", "not-fed", "also-not-fed"]),
                DigestSection(heading="Empty", body="", items=[]),
            ],
        )

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)

    result = await dig.my_digest(user_id="u")

    sections = result["digest"]["sections"]
    assert len(sections) == 1
    assert sections[0]["heading"] == "Real"
    assert sections[0]["source_note_ids"] == ["n1"]


# --- cache write uses merge (sibling user fields survive) -------------------------------------

async def test_cache_write_merges_and_preserves_sibling_fields(fake_db, monkeypatch):
    async def fake_build(display_name, window_label, notes):
        return CollectionDigest(intro="fresh")

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", days_ago=1)
    _seed_note(fake_db, "n2", days_ago=2)
    _seed_note(fake_db, "n3", days_ago=3)
    fake_db.seed("users", "u", {
        "display_name": "Yash", "region": "IN", "categories": ["recipe", "article"],
    })

    await dig.my_digest(user_id="u")

    stored = fake_db.docs[("users", "u")]
    assert stored["region"] == "IN"
    assert stored["categories"] == ["recipe", "article"]
    assert stored["display_name"] == "Yash"
    assert stored["digest"]["intro"] == "fresh"


# --- unauthenticated -------------------------------------------------------------------------

async def test_unauthenticated_raises_401():
    from services.auth_dep import require_user
    with pytest.raises(HTTPException) as e:
        await require_user(None)
    assert e.value.status_code == 401


# --- Gemini-level: items/source_note_ids outside fed set filtered via shared _run_digest ------

from conftest import chat_resp as _FakeResp  # noqa: E402


def test_build_personal_digest_drops_entries_and_ids_outside_fed_set(monkeypatch):
    from services.gemini import gemini_service

    payload = {
        "intro": "digest",
        "facts": [],
        "sections": [
            {"heading": "Real", "body": "syn", "items": [
                {"title": "Real", "summary": "s", "note_id": "n1"},
                {"title": "Fake", "summary": "s", "note_id": "not-fed"},
            ]},
            {"heading": "Empty after drop", "body": "", "items": [
                {"title": "Only fake", "summary": "s", "note_id": "also-not-fed"},
            ]},
        ],
    }

    def fake_generate(*args, **kwargs):
        return _FakeResp(_json.dumps(payload))

    monkeypatch.setattr(gemini_service.client.chat.completions, "create", fake_generate)

    digest = gemini_service._build_personal_digest("Yash", "your latest saves", [
        {"id": "n1", "content_type": "recipe", "title": "Cake", "source_domain": "x.com",
         "ai_summary": "", "data": {}},
    ])

    assert digest is not None
    # "Empty after drop" had its only entry stripped (foreign id) and no body → itself dropped.
    assert len(digest.sections) == 1
    assert digest.sections[0].heading == "Real"
    assert [i.note_id for i in digest.sections[0].items] == ["n1"]
