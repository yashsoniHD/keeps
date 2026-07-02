"""PATCH/DELETE/search/add/details /place-items: visit state, rating, notes, ownership."""
import pytest
from fastapi import HTTPException

import routers.place_items as pi_mod

COL = "users/u/place_items"


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(pi_mod, "get_db", lambda: fake_db)
    return fake_db


async def test_promote_saved_to_visit(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "saved", "visited_at": None})
    res = await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="to_visit"),
                                         user_id="u")
    assert res == {"ok": True}
    assert fake_db.docs[(COL, "g_1")]["place_status"] == "to_visit"
    assert fake_db.docs[(COL, "g_1")]["visited_at"] is None


async def test_mark_visited_stamps_visited_at(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "to_visit", "visited_at": None})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="visited"),
                                   user_id="u")
    assert fake_db.docs[(COL, "g_1")]["visited_at"] is not None


async def test_unvisit_clears_visited_at(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "visited", "visited_at": "x"})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="to_visit"),
                                   user_id="u")
    assert fake_db.docs[(COL, "g_1")]["visited_at"] is None


async def test_mark_visited_seeds_visit_count_one(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "to_visit", "visit_count": 0})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="visited"),
                                   user_id="u")
    assert fake_db.docs[(COL, "g_1")]["visit_count"] == 1


async def test_log_visit_increments_count_and_keeps_history(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "visited", "visit_count": 2})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(log_visit=True), user_id="u")
    doc = fake_db.docs[(COL, "g_1")]
    assert doc["visit_count"] == 3
    assert doc["place_status"] == "visited"
    assert doc["visited_at"] is not None  # last-visit advanced, not reset


async def test_log_visit_on_unvisited_place_sets_count_one_and_been(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "to_visit", "visit_count": 0})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(log_visit=True), user_id="u")
    doc = fake_db.docs[(COL, "g_1")]
    assert doc["visit_count"] == 1
    assert doc["place_status"] == "visited"


async def test_remark_visited_does_not_double_count(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "visited", "visit_count": 2})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="visited"),
                                   user_id="u")
    assert fake_db.docs[(COL, "g_1")]["visit_count"] == 2  # idempotent re-mark


async def test_leaving_been_resets_visit_count(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "visited", "visit_count": 3})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="to_visit"),
                                   user_id="u")
    assert fake_db.docs[(COL, "g_1")]["visit_count"] == 0


async def test_toggle_favorite(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "saved", "favorite": False})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(favorite=True), user_id="u")
    assert fake_db.docs[(COL, "g_1")]["favorite"] is True
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(favorite=False), user_id="u")
    assert fake_db.docs[(COL, "g_1")]["favorite"] is False


async def test_set_user_rating(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "visited"})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(user_rating=4), user_id="u")
    assert fake_db.docs[(COL, "g_1")]["user_rating"] == 4


async def test_set_and_clear_user_notes(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "user_notes": "old"})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(user_notes="great dosa"),
                                   user_id="u")
    assert fake_db.docs[(COL, "g_1")]["user_notes"] == "great dosa"
    # explicit null clears it
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(user_notes=None), user_id="u")
    assert fake_db.docs[(COL, "g_1")]["user_notes"] is None


async def test_omitted_notes_left_untouched(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "user_notes": "keep", "place_status": "saved"})
    await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="to_visit"),
                                   user_id="u")
    assert fake_db.docs[(COL, "g_1")]["user_notes"] == "keep"


def test_bad_status_rejected():
    with pytest.raises(Exception):  # pydantic pattern ^(saved|to_visit|visited)$
        pi_mod.PlaceItemUpdate(place_status="archived")


def test_rating_out_of_range_rejected():
    with pytest.raises(Exception):  # pydantic ge=1 le=5
        pi_mod.PlaceItemUpdate(user_rating=9)


async def test_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await pi_mod.update_place_item("nope", pi_mod.PlaceItemUpdate(place_status="to_visit"),
                                       user_id="u")
    assert exc.value.status_code == 404


async def test_non_owner_cannot_touch_anothers_item(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u", "place_status": "to_visit"})
    with pytest.raises(HTTPException) as exc:
        await pi_mod.update_place_item("g_1", pi_mod.PlaceItemUpdate(place_status="visited"),
                                       user_id="intruder")
    assert exc.value.status_code == 404
    assert fake_db.docs[(COL, "g_1")]["place_status"] == "to_visit"  # untouched


async def test_delete_item(fake_db):
    fake_db.seed(COL, "g_1", {"user_id": "u"})
    await pi_mod.delete_place_item("g_1", user_id="u")
    assert (COL, "g_1") not in fake_db.docs


async def test_search_delegates_to_google_places(monkeypatch):
    async def fake_search(q):
        assert q == "cafe bandra"
        return [{"place_id": "p1", "name": "Blue Tokai"}]
    monkeypatch.setattr(pi_mod.google_places, "search", fake_search)
    res = await pi_mod.search_places("cafe bandra", user_id="u")
    assert res == {"results": [{"place_id": "p1", "name": "Blue Tokai"}]}


async def test_create_delegates_to_add_by_place_id(monkeypatch):
    async def fake_add(uid, place_id):
        assert (uid, place_id) == ("u", "p1")
        return "g_p1"
    monkeypatch.setattr(pi_mod, "add_by_place_id", fake_add)
    res = await pi_mod.create_place_item(pi_mod.PlaceItemCreate(place_id="p1"), user_id="u")
    assert res == {"id": "g_p1"}


async def test_create_bad_place_id_400(monkeypatch):
    async def fake_add(uid, place_id):
        raise ValueError("Place not found.")
    monkeypatch.setattr(pi_mod, "add_by_place_id", fake_add)
    with pytest.raises(HTTPException) as exc:
        await pi_mod.create_place_item(pi_mod.PlaceItemCreate(place_id="x"), user_id="u")
    assert exc.value.status_code == 400


async def test_details_empty_when_no_place_id(fake_db):
    fake_db.seed(COL, "raw_x", {"user_id": "u"})  # raw item, no place_id
    assert await pi_mod.place_item_details("raw_x", user_id="u") == {}


async def test_details_fetches_when_matched(fake_db, monkeypatch):
    fake_db.seed(COL, "g_p1", {"user_id": "u", "place_id": "p1"})
    async def fake_details(pid):
        assert pid == "p1"
        return {"place_id": "p1", "name": "Blue Tokai"}
    monkeypatch.setattr(pi_mod.google_places, "place_details", fake_details)
    assert await pi_mod.place_item_details("g_p1", user_id="u") == {"place_id": "p1",
                                                                    "name": "Blue Tokai"}


async def test_backfill_delegates_to_service(monkeypatch):
    async def fake_backfill(uid):
        assert uid == "u"
        return {"notes_processed": 2, "venues_found": 3}
    monkeypatch.setattr(pi_mod, "backfill_user", fake_backfill)

    async def fake_reserve(uid, app):
        assert app == "places"
        return True
    monkeypatch.setattr(pi_mod, "reserve_backfill_run", fake_reserve)
    monkeypatch.setattr(pi_mod, "start_metering", lambda: object())
    async def fake_flush(uid, meter):
        return None
    monkeypatch.setattr(pi_mod, "flush_usage", fake_flush)
    assert await pi_mod.backfill_place_items(user_id="u") == {"notes_processed": 2,
                                                              "venues_found": 3}


async def test_backfill_cap_hit_is_429(monkeypatch):
    async def fake_reserve(uid, app):
        return False
    monkeypatch.setattr(pi_mod, "reserve_backfill_run", fake_reserve)

    async def fake_backfill(uid):  # must never run once the cap rejects
        raise AssertionError("backfill ran past the cap")
    monkeypatch.setattr(pi_mod, "backfill_user", fake_backfill)

    with pytest.raises(HTTPException) as exc:
        await pi_mod.backfill_place_items(user_id="u")
    assert exc.value.status_code == 429
