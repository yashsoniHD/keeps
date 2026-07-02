"""Clip AI grounding over mini-app items (Phase 2).

Since recipes/movies/products/places/trips no longer create note docs, Clip AI must ground on the
items themselves via the unified search_index. These tests cover the id-prefix scheme, the
item→note-shape adapter, prefix-aware resolution, and candidate-pool merging.
"""
import services.note_retrieval as nr


def test_id_prefix_roundtrip():
    assert nr._prefixed_id("recipe", "r_abc") == "recipe-r_abc"
    assert nr._split_id("recipe-r_abc") == ("recipe", "r_abc")
    assert nr._split_id("place-g_p1") == ("place", "g_p1")
    # A plain note uuid has no item prefix → resolves as a note.
    assert nr._split_id("550e8400-e29b-41d4-a716-446655440000") == (
        None, "550e8400-e29b-41d4-a716-446655440000")


def test_item_to_grounding_shape():
    d = {"user_id": "u", "title": "Blue Tokai", "why": "great filter coffee",
         "photo_url": "https://lh3/x.jpg", "domain": "instagram.com", "rating": 4.5}
    g = nr._item_to_grounding("place", "g_p1", d)
    assert g["id"] == "place-g_p1"
    assert g["app"] == "places" and g["ref_id"] == "g_p1"
    assert g["title"] == "Blue Tokai"
    assert g["ai_summary"] == "great filter coffee"   # falls back to `why`
    assert g["cover_image_url"] == "https://lh3/x.jpg"
    assert g["data"] is d                              # full item is the grounding data


async def test_fetch_resolves_notes_and_items_in_order(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "An article",
                                 "ai_summary": "s", "data": {}})
    fake_db.docs[("users/u/recipe_items", "r_1")] = {
        "user_id": "u", "title": "Dal Tadka", "ingredients": [{"items": ["dal"]}],
    }
    out = await nr.fetch_notes_by_ids(fake_db, "u", ["recipe-r_1", "n1"])
    # Order preserved: item first, then note.
    assert [x["id"] for x in out] == ["recipe-r_1", "n1"]
    item = out[0]
    assert item["app"] == "recipes" and item["ref_id"] == "r_1"
    assert item["content_type"] == "recipe"
    assert item["data"]["ingredients"] == [{"items": ["dal"]}]


async def test_fetch_skips_foreign_and_missing(fake_db):
    fake_db.docs[("users/u/watch_items", "m_1")] = {"user_id": "someone_else", "title": "X"}
    out = await nr.fetch_notes_by_ids(fake_db, "u", ["watch-m_1", "watch-missing"])
    assert out == []  # foreign owner + missing doc both drop out


async def test_candidate_pool_merges_items(fake_db, monkeypatch):
    # One recent note and one indexed recipe item; both should land in the pool.
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Note one",
                                 "ai_summary": "s", "created_at": 2, "embedding": [0.0]})
    fake_db.docs[("search_index", "recipe-r_1")] = {
        "user_id": "u", "kind": "recipe", "ref_id": "r_1", "app": "recipes",
        "title": "Dal Tadka", "summary": "comfort food", "embedding": [0.0], "created_at": 1,
    }
    # A note entry in the index must NOT double-count (notes come from the notes-collection pool).
    fake_db.docs[("search_index", "note-n1")] = {
        "user_id": "u", "kind": "note", "ref_id": "n1", "app": None,
        "title": "Note one", "embedding": [0.0], "created_at": 2,
    }
    pool = await nr.candidate_pool(fake_db, "u", "what should I cook")
    ids = {p["id"] for p in pool}
    assert "n1" in ids               # the note (raw id)
    assert "recipe-r_1" in ids       # the item (prefixed id)
    assert "note-n1" not in ids      # index note entry skipped, no duplicate
