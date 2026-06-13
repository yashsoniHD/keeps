"""Category management: rename re-tags + swaps the array entry; delete re-tags notes to
a non-destructive fallback. The Firestore-touching helpers (retag_notes / counts / array
mutations) are mocked here — these tests pin the router's orchestration logic: which slug
wins, what the fallback target is, and the order of array mutations."""
import pytest

import routers.categories as cat


@pytest.fixture
def spy(monkeypatch):
    """Replace every firebase helper the router calls with a recorder."""
    calls: dict[str, list] = {
        "retag": [], "add": [], "remove": [],
        "set_meta": [], "move_meta": [], "remove_meta": [],
    }
    cats = {"value": ["recipe", "summary"]}
    counts = {"recipe": 3, "summary": 1}
    meta: dict[str, dict] = {}

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

    async def fake_get_meta(uid):
        return {k: dict(v) for k, v in meta.items()}

    async def fake_set_meta(uid, slug, icon=None, palette=None):
        calls["set_meta"].append((uid, slug, icon, palette))
        entry = meta.setdefault(slug, {})
        if icon is not None:
            entry["icon"] = icon
        if palette is not None:
            entry["palette"] = palette

    async def fake_move_meta(uid, old, new):
        calls["move_meta"].append((uid, old, new))
        if old != new and old in meta:
            meta[new] = meta.pop(old)

    async def fake_remove_meta(uid, slug):
        calls["remove_meta"].append((uid, slug))
        meta.pop(slug, None)

    monkeypatch.setattr(cat, "get_user_categories", fake_get_cats)
    monkeypatch.setattr(cat, "count_notes_by_type", fake_counts)
    monkeypatch.setattr(cat, "retag_notes", fake_retag)
    monkeypatch.setattr(cat, "add_user_category", fake_add)
    monkeypatch.setattr(cat, "remove_user_category", fake_remove)
    monkeypatch.setattr(cat, "get_category_meta", fake_get_meta)
    monkeypatch.setattr(cat, "set_category_meta", fake_set_meta)
    monkeypatch.setattr(cat, "move_category_meta", fake_move_meta)
    monkeypatch.setattr(cat, "remove_category_meta", fake_remove_meta)
    return calls, cats, meta


async def test_list_joins_slugs_with_counts(spy):
    res = await cat.list_categories(user_id="u")
    assert res == [
        {"slug": "recipe", "count": 3, "icon": None, "palette": None},
        {"slug": "summary", "count": 1, "icon": None, "palette": None},
    ]


async def test_list_surfaces_icon_and_palette(spy):
    _, _, meta = spy
    meta["recipe"] = {"icon": "ChefHat", "palette": 2}
    res = await cat.list_categories(user_id="u")
    assert res[0] == {"slug": "recipe", "count": 3, "icon": "ChefHat", "palette": 2}


async def test_create_registers_new_slug(spy):
    calls, _, _ = spy
    res = await cat.create_category(cat.CategoryCreate(name="Travel Plans"), user_id="u")
    assert res == {"slug": "travel-plans", "count": 0, "icon": None, "palette": None}
    assert calls["add"] == [("u", "travel-plans")]       # slug registered
    assert calls["retag"] == []                          # nothing re-tagged on create
    assert calls["set_meta"] == []                       # no override when none supplied


async def test_create_with_icon_and_palette_pins_meta(spy):
    calls, _, _ = spy
    res = await cat.create_category(
        cat.CategoryCreate(name="Travel", icon="Plane", palette=1), user_id="u"
    )
    assert res == {"slug": "travel", "count": 0, "icon": "Plane", "palette": 1}
    assert calls["set_meta"] == [("u", "travel", "Plane", 1)]


async def test_create_rejects_out_of_range_palette(spy):
    calls, _, _ = spy
    res = await cat.create_category(
        cat.CategoryCreate(name="Travel", palette=99), user_id="u"
    )
    assert res["palette"] is None        # clamped out → no override
    assert calls["set_meta"] == []


async def test_create_collapses_onto_existing(spy):
    """Adding a near-duplicate of an existing category resolves to that category instead
    of forking the taxonomy — and reports its real note count."""
    calls, _, _ = spy
    res = await cat.create_category(cat.CategoryCreate(name="Recipes"), user_id="u")
    assert res == {"slug": "recipe", "count": 3, "icon": None, "palette": None}
    assert calls["add"] == [("u", "recipe")]


async def test_rename_retags_and_swaps_array(spy):
    calls, _, _ = spy
    res = await cat.update_category("recipe", cat.CategoryUpdate(new_name="Cooking"), user_id="u")
    assert res == {"slug": "cooking", "count": 3, "icon": None, "palette": None}
    assert calls["retag"] == [("u", "recipe", "cooking")]   # notes moved old → new
    assert calls["add"] == [("u", "cooking")]               # new slug registered
    assert calls["remove"] == [("u", "recipe")]             # old slug dropped
    assert calls["move_meta"] == [("u", "recipe", "cooking")]  # override carried over


async def test_update_sets_icon_and_palette_without_rename(spy):
    calls, _, _ = spy
    res = await cat.update_category(
        "recipe", cat.CategoryUpdate(icon="ChefHat", palette=0), user_id="u"
    )
    assert res == {"slug": "recipe", "count": 0, "icon": "ChefHat", "palette": 0}
    assert calls["set_meta"] == [("u", "recipe", "ChefHat", 0)]
    assert calls["retag"] == []          # no notes re-tagged on a pure re-skin
    assert calls["move_meta"] == []      # slug unchanged


async def test_rename_collapsing_to_existing_merges(spy):
    """Renaming "recipe" to something that normalises onto the existing "summary"
    category is an intentional merge — notes move and the old slug is removed."""
    calls, _, _ = spy
    res = await cat.update_category("recipe", cat.CategoryUpdate(new_name="Summary"), user_id="u")
    assert res["slug"] == "summary"
    assert calls["retag"] == [("u", "recipe", "summary")]
    assert calls["remove"] == [("u", "recipe")]


async def test_rename_to_own_singular_is_not_a_noop(spy):
    """"recipes" → "recipe" must actually apply: the slug being renamed is excluded from
    the match candidates, so it isn't collapsed back onto itself via the plural rule."""
    calls, cats, _ = spy
    cats["value"] = ["recipes", "summary"]
    res = await cat.update_category("recipes", cat.CategoryUpdate(new_name="recipe"), user_id="u")
    assert res["slug"] == "recipe"
    assert calls["retag"] == [("u", "recipes", "recipe")]
    assert calls["remove"] == [("u", "recipes")]


async def test_delete_moves_notes_to_summary_default(spy):
    calls, _, _ = spy
    res = await cat.delete_category("recipe", user_id="u")
    assert res == {"moved_to": "summary", "count": 3}
    assert calls["retag"] == [("u", "recipe", "summary")]   # notes preserved, moved
    assert calls["add"] == [("u", "summary")]               # target chip ensured
    assert calls["remove"] == [("u", "recipe")]
    assert calls["remove_meta"] == [("u", "recipe")]        # override cleaned up


async def test_delete_summary_falls_back_to_bookmark(spy):
    """Deleting the default target itself can't move its notes onto the slug being
    removed — it falls back to "bookmark"."""
    calls, _, _ = spy
    res = await cat.delete_category("summary", user_id="u")
    assert res["moved_to"] == "bookmark"
    assert calls["retag"] == [("u", "summary", "bookmark")]
    assert calls["remove"] == [("u", "summary")]


async def test_delete_honours_explicit_move_to(spy):
    calls, _, _ = spy
    res = await cat.delete_category("recipe", move_to="Recipe Box", user_id="u")
    assert res["moved_to"] == "recipe-box"
    assert calls["retag"] == [("u", "recipe", "recipe-box")]
