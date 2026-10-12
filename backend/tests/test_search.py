"""/api/search: keyword (title/summary substring) + vector pass directly on `notes`."""
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


async def test_short_query_is_400(fake_db):
    with pytest.raises(HTTPException) as exc:
        await search_mod.search(q="ab", user_id="u")
    assert exc.value.status_code == 400


async def test_search_bumps_counter(fake_db):
    assert await search_mod.search(q="chicken", user_id="u") == {"results": []}
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


async def test_ranking_title_then_summary_then_vector_and_dedup(fake_db):
    fake_db.seed("notes", "t1", {"user_id": "u", "title": "My pinterest board", "ai_summary": "",
                                 "content_type": "summary", "embedding": [0.0] * 8})
    fake_db.seed("notes", "s1", {"user_id": "u", "title": "Mango sago",
                                 "ai_summary": "From Pinterest", "content_type": "recipe"})
    fake_db.seed("notes", "v1", {"user_id": "u", "title": "Semantic match", "ai_summary": "",
                                 "embedding": [0.0] * 8})
    fake_db.seed("notes", "other", {"user_id": "x", "title": "pinterest", "embedding": [0.0] * 8})

    result = await search_mod.search(q="Pinterest", user_id="u")
    ids = [r["id"] for r in result["results"]]
    assert ids == ["t1", "s1", "v1"]          # t1 appears once despite also being a vector hit
    assert result["results"][1]["content_type"] == "recipe"
    assert "collection_id" not in result["results"][0]


async def test_result_cap_is_enforced(fake_db):
    for i in range(settings.SEARCH_LIMIT + 5):
        fake_db.seed("notes", f"n{i}", {"user_id": "u", "title": f"pinterest board {i}"})
    result = await search_mod.search(q="pinterest", user_id="u")
    assert len(result["results"]) == settings.SEARCH_LIMIT


async def test_vector_query_uses_server_side_threshold_and_thumbs_attach(fake_db, monkeypatch):
    async def emb(q):
        return [0.0] * 8
    monkeypatch.setattr(search_mod.embedding_service, "embed_query", emb)
    seen = {}
    FakeCollection = type(fake_db.collection("notes"))
    orig = FakeCollection.find_nearest

    def spy(self, **kw):
        seen.update(kw)
        return orig(self, **kw)
    monkeypatch.setattr(FakeCollection, "find_nearest", spy)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "zzzqqq", "cover_thumb": "data:image/jpeg;base64,AA"})
    res = await search_mod.search(q="zzzqqq", user_id="u")
    assert seen["distance_threshold"] == settings.SEARCH_MAX_DISTANCE
    assert res["results"][0]["cover_thumb"] == "data:image/jpeg;base64,AA"
