"""Recipes enrichment: recipe notes → recipe_items (URL dedup, no-clobber, ingredient guard)."""
import pytest

import services.recipes as rp

COL = "users/u/recipe_items"


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(rp, "get_db", lambda: fake_db)
    return fake_db


def _data(**over):
    base = {
        "totalTime": "35 min", "prepTime": "10 min", "cookTime": "25 min",
        "servings": "4", "difficulty": "Easy", "cuisine": "Italian",
        "ingredients": [{"group": "For the sauce", "items": ["2 onions", "1 tbsp oil"]}],
        "steps": ["Chop onions", "Simmer"], "tips": ["Use fresh basil"],
    }
    base.update(over)
    return base


# --- pure helpers -----------------------------------------------------------------

def test_canonical_url_strips_tracking_and_fragment():
    a = rp._canonical_url("https://Food.com/r/pasta/?utm_source=x&gclid=y#reviews")
    b = rp._canonical_url("https://food.com/r/pasta?ref=newsletter")
    assert a == b == "https://food.com/r/pasta"


def test_canonical_url_keeps_real_query_params():
    assert rp._canonical_url("https://food.com/recipe?id=42") == "https://food.com/recipe?id=42"
    assert rp._canonical_url("not a url") is None


def test_doc_id_prefers_url_then_falls_back_to_title():
    assert rp._doc_id("https://food.com/r/pasta", "Pasta").startswith("r_")
    assert rp._doc_id(None, "Creamy Pasta") == "r_creamy-pasta"


# --- fan-out ----------------------------------------------------------------------

async def test_recipe_note_fans_out_into_a_recipe_item(fake_db):
    await rp.enrich_recipe_item("u", "note-1", title="Creamy Pasta",
                                cover_image_url="https://img/x.jpg",
                                source_url="https://food.com/r/pasta",
                                source_domain="food.com", data=_data())
    keys = [k for k in fake_db.docs if k[0] == COL]
    assert len(keys) == 1
    item = fake_db.docs[keys[0]]
    assert item["title"] == "Creamy Pasta"
    assert item["cuisine"] == "Italian"
    assert item["image_url"] == "https://img/x.jpg"
    assert item["source_url"] == "https://food.com/r/pasta"
    assert item["total_time"] == "35 min"
    assert item["servings"] == "4"
    assert item["difficulty"] == "Easy"
    assert item["ingredients"] == [{"group": "For the sauce", "items": ["2 onions", "1 tbsp oil"]}]
    assert item["steps"] == ["Chop onions", "Simmer"]
    assert item["tips"] == ["Use fresh basil"]
    # user state seeded once.
    assert item["favorite"] is False
    assert item["created_at"] is not None


async def test_same_recipe_across_notes_dedupes_by_canonical_url(fake_db):
    await rp.enrich_recipe_item("u", "n1", title="Pasta", cover_image_url=None,
                                source_url="https://food.com/r/pasta?utm_source=ig",
                                source_domain="food.com", data=_data())
    await rp.enrich_recipe_item("u", "n2", title="Pasta (again)", cover_image_url=None,
                                source_url="https://food.com/r/pasta?ref=mail",
                                source_domain="food.com", data=_data())
    assert len([k for k in fake_db.docs if k[0] == COL]) == 1  # one recipe, not two


async def test_urlless_recipe_keyed_by_title(fake_db):
    await rp.enrich_recipe_item("u", "n1", title="Grandma's Stew", cover_image_url=None,
                                source_url=None, source_domain=None, data=_data())
    key = [k for k in fake_db.docs if k[0] == COL][0]
    assert key[1] == "r_grandma-s-stew"


async def test_resave_does_not_clobber_favorite(fake_db):
    fake_db.seed(COL, "seed", {})  # noise
    await rp.enrich_recipe_item("u", "n1", title="Pasta", cover_image_url=None,
                                source_url="https://food.com/r/pasta",
                                source_domain="food.com", data=_data())
    item_key = [k for k in fake_db.docs if k[0] == COL and k[1] != "seed"][0]
    fake_db.docs[item_key].update({"favorite": True})
    # Re-save with refreshed data.
    await rp.enrich_recipe_item("u", "n2", title="Pasta", cover_image_url=None,
                                source_url="https://food.com/r/pasta",
                                source_domain="food.com", data=_data(servings="6"))
    item = fake_db.docs[item_key]
    assert item["favorite"] is True       # preserved
    assert item["servings"] == "6"        # enrichment refreshed


async def test_skips_note_with_no_ingredients(fake_db):
    # A cooking-family composer note (no ingredients) must not create a junk item.
    await rp.enrich_recipe_item("u", "n1", title="10 baking tips", cover_image_url=None,
                                source_url="https://blog.com/tips", source_domain="blog.com",
                                data={"sections": [{"heading": "Tips", "body": "..."}]})
    assert not any(k[0] == COL for k in fake_db.docs)


async def test_backfill_copies_existing_recipe_notes(fake_db):
    fake_db.seed("notes", "r1", {"user_id": "u", "content_type": "recipe",
                                 "title": "Pasta", "cover_image_url": "https://i/1.jpg",
                                 "source_url": "https://food.com/r/pasta",
                                 "source_domain": "food.com", "data": _data()})
    fake_db.seed("notes", "b1", {"user_id": "u", "content_type": "baking",
                                 "title": "Bread", "data": _data()})
    fake_db.seed("notes", "p1", {"user_id": "u", "content_type": "product",
                                 "title": "Pan", "data": {"price": "$10"}})  # not recipe
    res = await rp.backfill_user("u")
    assert res == {"notes_processed": 2, "recipes_found": 2}
    assert len([k for k in fake_db.docs if k[0] == COL]) == 2
