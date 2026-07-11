"""PATCH/DELETE /wish-items/{id}: ownership scoping, purchased_at stamping, target price."""
import pytest
from fastapi import HTTPException

import routers.wish_items as wi_mod

COL = "users/u/wish_items"


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(wi_mod, "get_db", lambda: fake_db)
    return fake_db


async def test_promote_saved_to_buy(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u", "wish_status": "saved", "purchased_at": None})
    res = await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(wish_status="to_buy"), user_id="u")
    assert res == {"ok": True}
    doc = fake_db.docs[(COL, "p_1")]
    assert doc["wish_status"] == "to_buy"
    assert doc["purchased_at"] is None


async def test_mark_purchased_stamps_purchased_at(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u", "wish_status": "to_buy", "purchased_at": None})
    await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(wish_status="purchased"), user_id="u")
    assert fake_db.docs[(COL, "p_1")]["purchased_at"] is not None


async def test_unpurchase_clears_purchased_at(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u", "wish_status": "purchased", "purchased_at": "x"})
    await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(wish_status="to_buy"), user_id="u")
    assert fake_db.docs[(COL, "p_1")]["purchased_at"] is None


async def test_set_target_price(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u", "wish_status": "to_buy"})
    await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(target_price=1500), user_id="u")
    assert fake_db.docs[(COL, "p_1")]["target_price"] == 1500


async def test_clear_target_price_with_explicit_null(fake_db):
    """An explicit null clears the target; an omitted field leaves it untouched."""
    fake_db.seed(COL, "p_1", {"user_id": "u", "target_price": 999})
    await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(target_price=None), user_id="u")
    assert fake_db.docs[(COL, "p_1")]["target_price"] is None


async def test_omitted_target_price_left_untouched(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u", "target_price": 999, "wish_status": "saved"})
    await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(wish_status="to_buy"), user_id="u")
    assert fake_db.docs[(COL, "p_1")]["target_price"] == 999  # not cleared


async def test_toggle_favorite(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u", "wish_status": "saved", "favorite": False})
    await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(favorite=True), user_id="u")
    assert fake_db.docs[(COL, "p_1")]["favorite"] is True
    await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(favorite=False), user_id="u")
    assert fake_db.docs[(COL, "p_1")]["favorite"] is False


def test_bad_status_rejected():
    with pytest.raises(Exception):  # pydantic pattern ^(saved|to_buy|purchased)$
        wi_mod.WishItemUpdate(wish_status="archived")


def test_negative_target_price_rejected():
    with pytest.raises(Exception):  # pydantic ge=0
        wi_mod.WishItemUpdate(target_price=-5)


async def test_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await wi_mod.update_wish_item("nope", wi_mod.WishItemUpdate(wish_status="to_buy"), user_id="u")
    assert exc.value.status_code == 404


async def test_non_owner_cannot_touch_anothers_item(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u", "wish_status": "to_buy"})
    with pytest.raises(HTTPException) as exc:
        await wi_mod.update_wish_item("p_1", wi_mod.WishItemUpdate(wish_status="purchased"), user_id="intruder")
    assert exc.value.status_code == 404
    assert fake_db.docs[(COL, "p_1")]["wish_status"] == "to_buy"  # untouched


async def test_delete_item(fake_db):
    fake_db.seed(COL, "p_1", {"user_id": "u"})
    await wi_mod.delete_wish_item("p_1", user_id="u")
    assert (COL, "p_1") not in fake_db.docs


async def test_delete_missing_item_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await wi_mod.delete_wish_item("nope", user_id="u")
    assert exc.value.status_code == 404


async def test_backfill_delegates_to_service(monkeypatch):
    async def fake_backfill(uid):
        assert uid == "u"
        return {"notes_processed": 3, "products_found": 3}
    monkeypatch.setattr(wi_mod, "backfill_user", fake_backfill)
    assert await wi_mod.backfill_wish_items(user_id="u") == {"notes_processed": 3, "products_found": 3}
