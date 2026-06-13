"""Category management: rename re-tags + swaps the array entry; delete re-tags notes to
a non-destructive fallback. The Firestore-touching helpers (retag_notes / counts / array
mutations) are mocked here — these tests pin the router's orchestration logic: which slug
wins, what the fallback target is, and the order of array mutations."""
import pytest

import routers.categories as cat


@pytest.fixture
def spy(monkeypatch):
    """Replace every firebase helper the router calls with a recorder."""
    calls: dict[str, list] = {"retag": [], "add": [], "remove": []}
    cats = {"value": ["recipe", "summary"]}
    counts = {"recipe": 3, "summary": 1}

    async def fake_get_cats(uid):
        return list(cats["value"])

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
    return calls, cats


async def test_list_joins_slugs_with_counts(spy):
    res = await cat.list_categories(user_id="u")
    assert res == [{"slug": "recipe", "count": 3}, {"slug": "summary", "count": 1}]


async def test_create_registers_new_slug(spy):
    calls, _ = spy
    res = await cat.create_category(cat.CategoryCreate(name="Travel Plans"), user_id="u")
    assert res == {"slug": "travel-plans", "count": 0}   # no notes yet
    assert calls["add"] == [("u", "travel-plans")]       # slug registered
    assert calls["retag"] == []                          # nothing re-tagged on create


async def test_create_collapses_onto_existing(spy):
    """Adding a near-duplicate of an existing category resolves to that category instead
    of forking the taxonomy — and reports its real note count."""
    calls, _ = spy
    res = await cat.create_category(cat.CategoryCreate(name="Recipes"), user_id="u")
    assert res == {"slug": "recipe", "count": 3}         # collapsed onto existing "recipe"
    assert calls["add"] == [("u", "recipe")]


async def test_rename_retags_and_swaps_array(spy):
    calls, _ = spy
    res = await cat.rename_category("recipe", cat.CategoryRename(new_name="Cooking"), user_id="u")
    assert res == {"slug": "cooking", "count": 3}
    assert calls["retag"] == [("u", "recipe", "cooking")]   # notes moved old → new
    assert calls["add"] == [("u", "cooking")]               # new slug registered
    assert calls["remove"] == [("u", "recipe")]             # old slug dropped


async def test_rename_collapsing_to_existing_merges(spy):
    """Renaming "recipe" to something that normalises onto the existing "summary"
    category is an intentional merge — notes move and the old slug is removed."""
    calls, _ = spy
    res = await cat.rename_category("recipe", cat.CategoryRename(new_name="Summary"), user_id="u")
    assert res["slug"] == "summary"
    assert calls["retag"] == [("u", "recipe", "summary")]
    assert calls["remove"] == [("u", "recipe")]


async def test_rename_to_own_singular_is_not_a_noop(spy):
    """"recipes" → "recipe" must actually apply: the slug being renamed is excluded from
    the match candidates, so it isn't collapsed back onto itself via the plural rule."""
    calls, cats = spy
    cats["value"] = ["recipes", "summary"]
    res = await cat.rename_category("recipes", cat.CategoryRename(new_name="recipe"), user_id="u")
    assert res["slug"] == "recipe"
    assert calls["retag"] == [("u", "recipes", "recipe")]
    assert calls["remove"] == [("u", "recipes")]


async def test_delete_moves_notes_to_summary_default(spy):
    calls, _ = spy
    res = await cat.delete_category("recipe", user_id="u")
    assert res == {"moved_to": "summary", "count": 3}
    assert calls["retag"] == [("u", "recipe", "summary")]   # notes preserved, moved
    assert calls["add"] == [("u", "summary")]               # target chip ensured
    assert calls["remove"] == [("u", "recipe")]


async def test_delete_summary_falls_back_to_bookmark(spy):
    """Deleting the default target itself can't move its notes onto the slug being
    removed — it falls back to "bookmark"."""
    calls, _ = spy
    res = await cat.delete_category("summary", user_id="u")
    assert res["moved_to"] == "bookmark"
    assert calls["retag"] == [("u", "summary", "bookmark")]
    assert calls["remove"] == [("u", "summary")]


async def test_delete_honours_explicit_move_to(spy):
    calls, _ = spy
    res = await cat.delete_category("recipe", move_to="Recipe Box", user_id="u")
    assert res["moved_to"] == "recipe-box"
    assert calls["retag"] == [("u", "recipe", "recipe-box")]
