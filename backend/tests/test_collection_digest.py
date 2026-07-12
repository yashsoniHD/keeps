"""Tests for the collection digest feature: a cached, composed digest per smart collection
(intro + optional facts + categorized sections of entries deep-linking to source notes),
built by Gemini from member notes and regenerated lazily when membership changes.

Router-level tests (`POST /collections/{id}/digest`) are called directly, bypassing FastAPI's
Depends — same pattern as test_collections_router.py. The "drop entries citing ids outside the
fed set" behavior lives in `GeminiService._build_digest` itself (not the router), so it's
tested directly against a faked Gemini client response, mirroring test_category_cap.py.
"""
import json as _json

import pytest
from fastapi import HTTPException

import routers.collections as col_router
from config import settings
from models.ask import CollectionDigest, DigestEntry, DigestSection


def _seed_note(fake_db, note_id, cid, created_at):
    fake_db.seed("notes", note_id, {
        "user_id": "u", "title": f"Note {note_id}", "content_type": "note",
        "ai_summary": "summary", "source_domain": "example.com",
        "collection_ids": [cid], "created_at": created_at, "data": {},
    })


def _seed_legacy_note(fake_db, note_id, cid, created_at):
    """A pre-migration note tagged only via the legacy scalar `collection_id` — no
    `collection_ids` array at all, so an array_contains query alone would miss it."""
    fake_db.seed("notes", note_id, {
        "user_id": "u", "title": f"Note {note_id}", "content_type": "note",
        "ai_summary": "summary", "source_domain": "example.com",
        "collection_id": cid, "created_at": created_at, "data": {},
    })


def _wire(monkeypatch, fake_db, *, reserve=True, build=None):
    """Wire get_db + reserve_collection_digest (429/stale check) + gemini build (rebuild path)
    + flush_usage (no-op — a real flush would hit the live Firestore singleton, same reasoning
    as test_search.py's patch_search fixture)."""
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)

    async def fake_reserve(uid, cid):
        return reserve
    monkeypatch.setattr(col_router, "reserve_collection_digest", fake_reserve)

    if build is not None:
        monkeypatch.setattr(col_router.gemini_service, "build_digest", build)

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(col_router, "flush_usage", fake_flush)


async def _no_reserve_call(uid, cid):
    raise AssertionError("reserve_collection_digest should not be called")


async def _no_build_call(*a, **k):
    raise AssertionError("build_digest should not be called")


# --- ownership -------------------------------------------------------------------------------

async def test_digest_missing_collection_404s(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db)
    with pytest.raises(HTTPException) as e:
        await col_router.digest("nope", user_id="u")
    assert e.value.status_code == 404


async def test_digest_non_owner_404s(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {"user_id": "someone-else", "name": "X"})
    with pytest.raises(HTTPException) as e:
        await col_router.digest("c1", user_id="u")
    assert e.value.status_code == 404


# --- empty collection --------------------------------------------------------------------------

async def test_empty_collection_returns_none_digest_no_gemini(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    monkeypatch.setattr(col_router, "reserve_collection_digest", _no_reserve_call)
    monkeypatch.setattr(col_router.gemini_service, "build_digest", _no_build_call)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip"})

    result = await col_router.digest("c1", user_id="u")
    assert result == {"digest": None}


# --- signature match: cached, no rebuild ------------------------------------------------------

async def test_signature_match_returns_stored_digest_zero_build_zero_reserve(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    monkeypatch.setattr(col_router, "reserve_collection_digest", _no_reserve_call)
    monkeypatch.setattr(col_router.gemini_service, "build_digest", _no_build_call)

    _seed_note(fake_db, "n1", "c1", 1)
    _seed_note(fake_db, "n2", "c1", 2)
    stored = {
        "intro": "cached intro", "facts": [], "sections": [],
        "source_note_ids": ["n1", "n2"], "coverage": None,
    }
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip", "digest": stored})

    result = await col_router.digest("c1", user_id="u")
    assert result == {"digest": stored, "stale": False}


async def test_force_rebuilds_even_on_signature_match(fake_db, monkeypatch):
    calls = []

    async def fake_build(name, description, notes):
        calls.append(1)
        return CollectionDigest(intro="fresh")

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", "c1", 1)
    stored = {"intro": "cached intro", "facts": [], "sections": [], "source_note_ids": ["n1"]}
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip", "digest": stored})

    result = await col_router.digest(
        "c1", body=col_router.DigestRequest(force=True), user_id="u")
    assert len(calls) == 1
    assert result["digest"]["intro"] == "fresh"


# --- rebuild on changed membership --------------------------------------------------------------

async def test_changed_membership_triggers_one_build_and_stores_sorted_ids(fake_db, monkeypatch):
    calls = []

    async def fake_build(name, description, notes):
        calls.append(notes)
        return CollectionDigest(
            intro="A trip digest", facts=[],
            sections=[DigestSection(heading="Places", items=[
                DigestEntry(title="Note n1", summary="s", note_id="n1"),
            ])],
        )

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", "c1", 1)
    _seed_note(fake_db, "n2", "c1", 2)
    fake_db.seed("collections", "c1", {
        "user_id": "u", "name": "Trip", "updated_at": "unchanged-sentinel",
        "digest": {"source_note_ids": ["n1"]},  # stale — n2 was added since this was built
    })

    result = await col_router.digest("c1", user_id="u")

    assert len(calls) == 1
    assert result["stale"] is False
    assert result["digest"]["source_note_ids"] == ["n1", "n2"]
    assert result["digest"]["intro"] == "A trip digest"
    stored = fake_db.docs[("collections", "c1")]
    assert stored["digest"]["source_note_ids"] == ["n1", "n2"]
    # The digest write must never touch updated_at (the library grid orders by it).
    assert stored["updated_at"] == "unchanged-sentinel"


# --- cap exhausted --------------------------------------------------------------------------------

async def test_cap_exhausted_returns_stale_existing_digest(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, reserve=False, build=_no_build_call)
    _seed_note(fake_db, "n1", "c1", 1)
    stored = {"intro": "old", "facts": [], "sections": [], "source_note_ids": ["different"]}
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip", "digest": stored})

    result = await col_router.digest("c1", user_id="u")
    assert result == {"digest": stored, "stale": True}


async def test_cap_exhausted_no_prior_digest_returns_none_and_stale(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, reserve=False, build=_no_build_call)
    _seed_note(fake_db, "n1", "c1", 1)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip"})

    result = await col_router.digest("c1", user_id="u")
    assert result == {"digest": None, "stale": True}


# --- build failure --------------------------------------------------------------------------------

async def test_build_failure_returns_stale_not_500(fake_db, monkeypatch):
    async def fake_build(name, description, notes):
        return None

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", "c1", 1)
    stored = {"intro": "old", "facts": [], "sections": [], "source_note_ids": ["different"]}
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip", "digest": stored})

    result = await col_router.digest("c1", user_id="u")
    assert result == {"digest": stored, "stale": True}


# --- >DIGEST_MAX_NOTES feeds newest N + sets coverage ----------------------------------------------

async def test_over_cap_feeds_newest_notes_and_sets_coverage(fake_db, monkeypatch):
    total = settings.DIGEST_MAX_NOTES + 5
    for i in range(total):
        _seed_note(fake_db, f"n{i}", "c1", i)  # ascending created_at — n(total-1) is newest

    captured = {}

    async def fake_build(name, description, notes):
        captured["notes"] = notes
        return CollectionDigest(intro="ok")

    _wire(monkeypatch, fake_db, build=fake_build)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip"})

    result = await col_router.digest("c1", user_id="u")

    fed_ids = {n["id"] for n in captured["notes"]}
    assert len(fed_ids) == settings.DIGEST_MAX_NOTES
    newest_ids = {f"n{i}" for i in range(total - settings.DIGEST_MAX_NOTES, total)}
    assert fed_ids == newest_ids
    assert (result["digest"]["coverage"]
            == f"Digest built from {settings.DIGEST_MAX_NOTES} of {total} notes.")
    assert sorted(result["digest"]["source_note_ids"]) == sorted(fed_ids)


# --- legacy scalar-tagged membership -------------------------------------------------------------

async def test_legacy_scalar_tagged_note_included_in_digest(fake_db, monkeypatch):
    """A collection with one array-tagged note and one legacy scalar-only note must feed BOTH
    to the digest — the array_contains query alone misses unmigrated notes."""
    calls = []

    async def fake_build(name, description, notes):
        calls.append(notes)
        return CollectionDigest(intro="ok")

    _wire(monkeypatch, fake_db, build=fake_build)
    _seed_note(fake_db, "n1", "c1", 1)          # array-tagged
    _seed_legacy_note(fake_db, "n2", "c1", 2)   # legacy scalar-only
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Trip"})

    result = await col_router.digest("c1", user_id="u")

    assert len(calls) == 1
    fed_ids = {n["id"] for n in calls[0]}
    assert fed_ids == {"n1", "n2"}
    assert sorted(result["digest"]["source_note_ids"]) == ["n1", "n2"]


# --- Gemini-level: out-of-set note_id entries dropped ----------------------------------------------

class _FakeResp:
    def __init__(self, text):
        self.text = text


def test_build_digest_drops_entries_citing_ids_outside_fed_set(monkeypatch):
    from services.gemini import gemini_service

    payload = {
        "intro": "digest",
        "facts": [],
        "sections": [
            {"heading": "Places", "items": [
                {"title": "Real", "summary": "s", "note_id": "n1"},
                {"title": "Fake", "summary": "s", "note_id": "not-fed"},
            ]},
            {"heading": "Empty after drop", "items": [
                {"title": "Only fake", "summary": "s", "note_id": "also-not-fed"},
            ]},
        ],
    }

    def fake_generate(*args, **kwargs):
        return _FakeResp(_json.dumps(payload))

    monkeypatch.setattr(gemini_service.client.models, "generate_content", fake_generate)

    digest = gemini_service._build_digest("Trip", "", [
        {"id": "n1", "content_type": "place", "title": "Cafe", "source_domain": "x.com",
         "ai_summary": "", "data": {}},
    ])

    assert digest is not None
    # The "Empty after drop" section had every entry stripped (foreign id) and is itself dropped.
    assert len(digest.sections) == 1
    assert digest.sections[0].heading == "Places"
    assert [i.note_id for i in digest.sections[0].items] == ["n1"]


def test_build_digest_returns_none_after_retry_exhausted(monkeypatch):
    from services.gemini import gemini_service

    def fake_generate(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(gemini_service.client.models, "generate_content", fake_generate)
    monkeypatch.setattr("services.gemini.time.sleep", lambda *_: None)

    digest = gemini_service._build_digest("Trip", "", [
        {"id": "n1", "content_type": "place", "title": "Cafe", "source_domain": "x.com",
         "ai_summary": "", "data": {}},
    ])
    assert digest is None


class _Unstringifiable:
    """A value whose __str__ raises — json.dumps(..., default=str) falls back to str() for
    non-serializable types, so this blows up prompt assembly itself, before any model call."""

    def __str__(self):
        raise RuntimeError("cannot stringify")


def test_build_digest_note_serialization_error_returns_none(monkeypatch):
    """A serialization edge case while building the prompt (outside the model-call retry loop)
    must still resolve to None, not propagate — the digest-miss-never-500s contract covers the
    whole method, not just the Gemini call."""
    from services.gemini import gemini_service

    def fake_generate(*args, **kwargs):
        raise AssertionError("generate_content should not be called")

    monkeypatch.setattr(gemini_service.client.models, "generate_content", fake_generate)

    digest = gemini_service._build_digest("Trip", "", [
        {"id": "n1", "content_type": "place", "title": "Cafe", "source_domain": "x.com",
         "ai_summary": "", "data": {"bad": _Unstringifiable()}},
    ])
    assert digest is None
