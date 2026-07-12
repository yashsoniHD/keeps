"""Router-level tests for the smart-collection endpoints: rescore, pin/exclude, and the delete
sweep. Endpoints are called directly, bypassing FastAPI's Depends — same pattern as
`notes_mod.update_note("n1", ..., user_id="u")` in test_notes_update.py.
"""
import pytest
from fastapi import HTTPException

import routers.collections as col_router
import services.collections as col_svc
from config import settings


def _wire(monkeypatch, fake_db, *, collections=None, reserve=True):
    """Wire get_user_collections (cap check) and reserve_collection_rescore (429 check) —
    both are only consulted by /rescore."""
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)

    async def cols(uid):
        return collections if collections is not None else []

    async def fake_reserve(uid, cid):
        return reserve

    monkeypatch.setattr(col_router, "get_user_collections", cols)
    monkeypatch.setattr(col_router, "reserve_collection_rescore", fake_reserve)


# --- rescore --------------------------------------------------------------------------------------

async def test_rescore_missing_collection_404s(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db)
    with pytest.raises(HTTPException) as e:
        await col_router.rescore("nope", user_id="u")
    assert e.value.status_code == 404


async def test_rescore_owner_check_404s(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {"user_id": "someone-else", "name": "X"})
    with pytest.raises(HTTPException) as e:
        await col_router.rescore("c1", user_id="u")
    assert e.value.status_code == 404


async def test_rescore_over_collection_count_cap_400(fake_db, monkeypatch):
    many = [{"id": f"c{i}"} for i in range(settings.MAX_COLLECTIONS_PER_USER + 1)]
    _wire(monkeypatch, fake_db, collections=many)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": ""})
    with pytest.raises(HTTPException) as e:
        await col_router.rescore("c1", user_id="u")
    assert e.value.status_code == 400


async def test_rescore_over_daily_cap_429(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, reserve=False)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": ""})
    with pytest.raises(HTTPException) as e:
        await col_router.rescore("c1", user_id="u")
    assert e.value.status_code == 429


async def test_rescore_under_caps_runs_and_returns_counts(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, collections=[{"id": "c1"}])
    fake_db.seed("collections", "c1", {
        "user_id": "u", "name": "Software", "description": "dev tools and gadgets",
    })
    res = await col_router.rescore("c1", user_id="u")
    assert set(res) >= {"matched", "added", "removed"}


# --- pin / exclude -------------------------------------------------------------------------------

async def test_pin_note_missing_collection_404s(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T"})
    with pytest.raises(HTTPException) as e:
        await col_router.pin_note("nope", "n1", user_id="u")
    assert e.value.status_code == 404


async def test_pin_note_missing_note_404s(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "X"})
    with pytest.raises(HTTPException) as e:
        await col_router.pin_note("c1", "nope", user_id="u")
    assert e.value.status_code == 404


async def test_pin_note_wrong_owner_404s(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "X"})
    fake_db.seed("notes", "n1", {"user_id": "someone-else", "title": "T"})
    with pytest.raises(HTTPException) as e:
        await col_router.pin_note("c1", "n1", user_id="u")
    assert e.value.status_code == 404


async def test_pin_note_adds_membership_scalar_and_mirror(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "X"})
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T", "ai_summary": ""})

    res = await col_router.pin_note("c1", "n1", user_id="u")

    assert res == {"ok": True}
    assert fake_db.docs[("collections", "c1")]["pinned_note_ids"] == ["n1"]
    assert fake_db.docs[("notes", "n1")]["collection_ids"] == ["c1"]
    assert fake_db.docs[("notes", "n1")]["collection_id"] == "c1"
    idx = fake_db.docs.get(("search_index", "note-n1"))
    assert idx is not None
    assert idx["collection_ids"] == ["c1"]
    assert idx["collection_id"] == "c1"


async def test_exclude_note_removes_membership(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "X"})
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T", "ai_summary": "",
        "collection_ids": ["c1"], "collection_id": "c1",
    })

    res = await col_router.exclude_note("c1", "n1", user_id="u")

    assert res == {"ok": True}
    assert fake_db.docs[("collections", "c1")]["excluded_note_ids"] == ["n1"]
    assert fake_db.docs[("notes", "n1")]["collection_ids"] == []
    assert fake_db.docs[("notes", "n1")]["collection_id"] is None


async def test_pin_survives_rescore(fake_db, monkeypatch):
    """A pinned note stays in even when a rescore's cosine similarity says it shouldn't."""
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": "dev tools"})
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T", "ai_summary": "", "embedding": [0.0, 1.0]})

    await col_router.pin_note("c1", "n1", user_id="u")

    async def fake_embed_query(text, *a, **k):
        return [1.0, 0.0]  # orthogonal to n1's embedding — would NOT match on its own

    monkeypatch.setattr(col_svc.embedding_service, "embed_query", fake_embed_query)
    await col_svc.rescore_collection(fake_db, "u", "c1")

    assert fake_db.docs[("notes", "n1")]["collection_ids"] == ["c1"]


async def test_exclude_blocks_readd_on_rescore(fake_db, monkeypatch):
    """An excluded note stays out even when a rescore's cosine similarity would otherwise match it."""
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": "dev tools"})
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T", "ai_summary": "", "embedding": [1.0, 0.0],
        "collection_ids": ["c1"], "collection_id": "c1",
    })

    await col_router.exclude_note("c1", "n1", user_id="u")

    async def fake_embed_query(text, *a, **k):
        return [1.0, 0.0]  # identical to n1's embedding — would match if not excluded

    monkeypatch.setattr(col_svc.embedding_service, "embed_query", fake_embed_query)
    await col_svc.rescore_collection(fake_db, "u", "c1")

    assert fake_db.docs[("notes", "n1")]["collection_ids"] == []


# --- delete sweep --------------------------------------------------------------------------------

async def test_delete_collection_owner_check_404s(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "someone-else", "name": "X"})
    with pytest.raises(HTTPException) as e:
        await col_router.delete_collection("c1", user_id="u")
    assert e.value.status_code == 404


async def test_delete_collection_strips_ids_from_member_notes(fake_db, monkeypatch):
    monkeypatch.setattr(col_router, "get_db", lambda: fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "X"})
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T1", "ai_summary": "",
        "collection_ids": ["c1", "c2"], "collection_id": "c1",
    })
    fake_db.seed("notes", "n2", {
        "user_id": "u", "title": "T2", "ai_summary": "",
        "collection_ids": ["c1"], "collection_id": "c1",
    })
    fake_db.seed("notes", "n3", {
        "user_id": "u", "title": "T3", "ai_summary": "",
        "collection_ids": ["c2"], "collection_id": "c2",  # untouched — not a member of c1
    })

    res = await col_router.delete_collection("c1", user_id="u")

    assert res["stripped"] == 2
    assert fake_db.docs[("notes", "n1")]["collection_ids"] == ["c2"]
    assert fake_db.docs[("notes", "n1")]["collection_id"] == "c2"
    assert fake_db.docs[("notes", "n2")]["collection_ids"] == []
    assert fake_db.docs[("notes", "n2")]["collection_id"] is None
    assert fake_db.docs[("notes", "n3")]["collection_ids"] == ["c2"]  # unaffected
    assert ("collections", "c1") not in fake_db.docs
