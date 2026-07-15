"""/api/search: the query embedding is a paid Vertex call, so the endpoint must be
capped (per-user daily counter) and metered (admin cost dashboard)."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import routers.search as search_mod
from config import settings

TODAY = datetime.now(timezone.utc).strftime("%Y%m%d")


@pytest.fixture(autouse=True)
def patch_search(fake_db, monkeypatch):
    monkeypatch.setattr(search_mod, "get_db", lambda: fake_db)
    return fake_db


async def test_search_meters_spend_and_bumps_counter(fake_db, monkeypatch):
    sentinel = object()
    flushed = []
    monkeypatch.setattr(search_mod, "start_metering", lambda: sentinel)

    async def fake_flush(uid, meter):
        flushed.append((uid, meter))
    monkeypatch.setattr(search_mod, "flush_usage", fake_flush)

    result = await search_mod.search(q="chicken recipes", user_id="u")
    assert result == {"results": []}
    assert flushed == [("u", sentinel)]  # embed spend attributed to the user
    assert fake_db.docs[("usage", f"u-{TODAY}")]["search_count"] == 1


async def test_search_cap_hit_is_429_before_any_embedding(fake_db, monkeypatch):
    fake_db.seed("usage", f"u-{TODAY}",
                 {"user_id": "u", "search_count": settings.MAX_SEARCHES_PER_USER_PER_DAY})

    async def no_embed(q):
        raise AssertionError("query embedded past the cap")
    monkeypatch.setattr(search_mod.embedding_service, "embed_query", no_embed)

    with pytest.raises(HTTPException) as exc:
        await search_mod.search(q="anything", user_id="u")
    assert exc.value.status_code == 429


async def test_search_returns_index_hits_with_content_type(fake_db, monkeypatch):
    from services import search_index
    fake_db.seed(search_index.COLLECTION, "note-n1",
                 {"user_id": "u", "kind": "note", "ref_id": "n1",
                  "content_type": "recipe", "title": "Butter chicken",
                  "summary": "Slow-cooked.", "cover_image_url": None,
                  "embedding": [0.0] * 8})

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(search_mod, "flush_usage", fake_flush)

    result = await search_mod.search(q="butter chicken", user_id="u")
    assert [r["ref_id"] for r in result["results"]] == ["n1"]
    # Note hits carry their real content_type (drives the result-row icon/accent).
    assert result["results"][0]["content_type"] == "recipe"


async def test_ranking_source_then_title_then_vector(fake_db, monkeypatch):
    from services import search_index

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(search_mod, "flush_usage", fake_flush)

    # Source hit: saved from pinterest, title unrelated to the query.
    fake_db.seed("notes", "s1", {"user_id": "u", "source_domain": "pin.it", "title": "Mango sago"})
    # Title-substring hit: title literally contains the query.
    fake_db.seed("notes", "t1", {"user_id": "u", "source_domain": "example.com",
                                 "title": "My pinterest board"})
    # Vector hit: only lives in the index.
    fake_db.seed(search_index.COLLECTION, "note-v1",
                 {"user_id": "u", "kind": "note", "ref_id": "v1", "title": "Semantic match",
                  "summary": "", "embedding": [0.0] * 8})

    result = await search_mod.search(q="pinterest", user_id="u")
    assert [r["id"] for r in result["results"]] == ["s1", "t1", "v1"]


async def test_dedup_keeps_first_occurrence(fake_db, monkeypatch):
    from services import search_index

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(search_mod, "flush_usage", fake_flush)

    # Same note is both a title-substring hit and a vector hit — it must appear once.
    fake_db.seed("notes", "d1", {"user_id": "u", "source_domain": "example.com",
                                 "title": "pinterest ideas"})
    fake_db.seed(search_index.COLLECTION, "note-d1",
                 {"user_id": "u", "kind": "note", "ref_id": "d1", "title": "pinterest ideas",
                  "summary": "", "embedding": [0.0] * 8})

    result = await search_mod.search(q="pinterest", user_id="u")
    assert [r["id"] for r in result["results"]] == ["d1"]


async def test_result_cap_is_enforced(fake_db, monkeypatch):
    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(search_mod, "flush_usage", fake_flush)

    for i in range(settings.SEARCH_LIMIT + 5):
        fake_db.seed("notes", f"n{i}", {"user_id": "u", "source_domain": "example.com",
                                        "title": f"pinterest board {i}"})

    result = await search_mod.search(q="pinterest", user_id="u")
    assert len(result["results"]) == settings.SEARCH_LIMIT
