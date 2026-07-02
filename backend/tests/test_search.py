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


async def test_search_returns_index_hits(fake_db, monkeypatch):
    from services import search_index
    fake_db.seed(search_index.COLLECTION, "e1",
                 {"user_id": "u", "kind": "recipe", "app": "recipes", "ref_id": "r_1",
                  "title": "Butter chicken", "summary": "Slow-cooked.",
                  "cover_image_url": None, "embedding": [0.0] * 8})

    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(search_mod, "flush_usage", fake_flush)

    result = await search_mod.search(q="butter chicken", user_id="u")
    assert [r["ref_id"] for r in result["results"]] == ["r_1"]
    assert result["results"][0]["app"] == "recipes"
