"""Categories: list joins counts; delete re-tags notes to a non-destructive fallback.
Firestore helpers are mocked — these pin the router's orchestration."""
import pytest

import routers.categories as cat


@pytest.fixture
def spy(monkeypatch):
    calls: dict[str, list] = {"retag": [], "add": [], "remove": []}
    counts = {"recipe": 3, "summary": 1}

    async def fake_get_cats(uid):
        return ["recipe", "summary"]

    async def fake_counts(uid):
        return dict(counts)

    async def fake_retag(uid, old, new):
        calls["retag"].append((uid, old, new))
        return counts.get(old, 0)

    async def fake_add(uid, slug):
        calls["add"].append((uid, slug))

    async def fake_remove(uid, slug):
        calls["remove"].append((uid, slug))

    monkeypatch.setattr(cat, "get_user_categories", fake_get_cats)
    monkeypatch.setattr(cat, "count_notes_by_type", fake_counts)
    monkeypatch.setattr(cat, "retag_notes", fake_retag)
    monkeypatch.setattr(cat, "add_user_category", fake_add)
    monkeypatch.setattr(cat, "remove_user_category", fake_remove)
    return calls


async def test_list_joins_slugs_with_counts(spy):
    assert await cat.list_categories(user_id="u") == [
        {"slug": "recipe", "count": 3}, {"slug": "summary", "count": 1}]


async def test_delete_moves_notes_to_summary_default(spy):
    res = await cat.delete_category("recipe", user_id="u")
    assert res == {"moved_to": "summary", "count": 3}
    assert spy["retag"] == [("u", "recipe", "summary")]
    assert spy["add"] == [("u", "summary")]
    assert spy["remove"] == [("u", "recipe")]


async def test_delete_summary_falls_back_to_bookmark(spy):
    res = await cat.delete_category("summary", user_id="u")
    assert res["moved_to"] == "bookmark"
    assert spy["retag"] == [("u", "summary", "bookmark")]


async def test_delete_honours_explicit_move_to(spy):
    res = await cat.delete_category("recipe", move_to="Recipe Box", user_id="u")
    assert res["moved_to"] == "recipe-box"
