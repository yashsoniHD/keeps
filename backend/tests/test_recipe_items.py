"""PATCH/DELETE /recipe-items/{id}: ownership scoping, favorite toggle."""
import pytest
from fastapi import HTTPException

import routers.recipe_items as ri_mod

COL = "users/u/recipe_items"


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(ri_mod, "get_db", lambda: fake_db)
    return fake_db


async def test_toggle_favorite(fake_db):
    fake_db.seed(COL, "r_1", {"user_id": "u", "favorite": False})
    res = await ri_mod.update_recipe_item("r_1", ri_mod.RecipeItemUpdate(favorite=True), user_id="u")
    assert res == {"ok": True}
    assert fake_db.docs[(COL, "r_1")]["favorite"] is True
    await ri_mod.update_recipe_item("r_1", ri_mod.RecipeItemUpdate(favorite=False), user_id="u")
    assert fake_db.docs[(COL, "r_1")]["favorite"] is False


async def test_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await ri_mod.update_recipe_item("nope", ri_mod.RecipeItemUpdate(favorite=True), user_id="u")
    assert exc.value.status_code == 404


async def test_non_owner_cannot_touch_anothers_item(fake_db):
    fake_db.seed(COL, "r_1", {"user_id": "u", "favorite": False})
    with pytest.raises(HTTPException) as exc:
        await ri_mod.update_recipe_item("r_1", ri_mod.RecipeItemUpdate(favorite=True), user_id="intruder")
    assert exc.value.status_code == 404
    assert fake_db.docs[(COL, "r_1")]["favorite"] is False  # untouched


async def test_delete_item(fake_db):
    fake_db.seed(COL, "r_1", {"user_id": "u"})
    await ri_mod.delete_recipe_item("r_1", user_id="u")
    assert (COL, "r_1") not in fake_db.docs


async def test_delete_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await ri_mod.delete_recipe_item("nope", user_id="u")
    assert exc.value.status_code == 404


async def test_backfill_delegates_to_service(monkeypatch):
    async def fake_backfill(uid):
        assert uid == "u"
        return {"notes_processed": 3, "recipes_found": 3}
    monkeypatch.setattr(ri_mod, "backfill_user", fake_backfill)
    assert await ri_mod.backfill_recipe_items(user_id="u") == {"notes_processed": 3, "recipes_found": 3}
