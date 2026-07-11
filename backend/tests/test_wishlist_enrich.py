"""Wishlist enrichment: product notes → wish_items (URL dedup, no-clobber, price parsing)."""
import pytest

import services.wishlist as wl

COL = "users/u/wish_items"


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(wl, "get_db", lambda: fake_db)
    return fake_db


def _data(**over):
    base = {
        "price": "₹2,499", "brand": "Acme", "rating": "4.5",
        "buyUrl": "https://shop.com/p/abc",
        "specs": [{"label": "Weight", "value": "200g"}],
        "pros": ["light"], "cons": ["pricey"], "verdict": "buy it",
    }
    base.update(over)
    return base


# --- pure helpers -----------------------------------------------------------------

@pytest.mark.parametrize("raw,amount,currency", [
    ("₹2,499", 2499.0, "₹"),
    ("$19.99", 19.99, "$"),
    ("Rs. 1,200", 1200.0, "Rs."),
    ("USD 49", 49.0, "USD"),
    ("1999", 1999.0, None),
    ("Free", None, None),
    (None, None, None),
])
def test_parse_price(raw, amount, currency):
    assert wl._parse_price(raw) == (amount, currency)


def test_canonical_url_strips_tracking_and_fragment():
    a = wl._canonical_url("https://Shop.com/p/abc/?utm_source=x&gclid=y#reviews")
    b = wl._canonical_url("https://shop.com/p/abc?ref=newsletter")
    assert a == b == "https://shop.com/p/abc"


def test_canonical_url_keeps_real_query_params():
    # A genuine product identifier in the query must survive (so variants stay distinct).
    assert wl._canonical_url("https://shop.com/item?pid=42") == "https://shop.com/item?pid=42"
    assert wl._canonical_url("not a url") is None


def test_coerce_rating_clamps_to_review_scale():
    assert wl._coerce_rating("4.5") == 4.5
    assert wl._coerce_rating(9) is None      # out of the 0–5 review scale
    assert wl._coerce_rating("n/a") is None


# --- fan-out ----------------------------------------------------------------------

async def test_product_note_fans_out_into_a_wish_item(fake_db):
    await wl.enrich_wish_item("u", "note-1", title="Acme Runner X",
                              cover_image_url="https://img/x.jpg",
                              source_domain="shop.com", data=_data())
    keys = [k for k in fake_db.docs if k[0] == COL]
    assert len(keys) == 1
    item = fake_db.docs[keys[0]]
    assert item["title"] == "Acme Runner X"
    assert item["brand"] == "Acme"
    assert item["image_url"] == "https://img/x.jpg"
    assert item["buy_url"] == "https://shop.com/p/abc"
    assert item["price_amount"] == 2499.0
    assert item["currency"] == "₹"
    assert item["rating"] == 4.5
    # user state seeded once, in the Saved inbox.
    assert item["wish_status"] == "saved"
    assert item["target_price"] is None
    assert item["purchased_at"] is None
    assert item["price_when_added"] == 2499.0
    assert item["created_at"] is not None


async def test_same_product_across_notes_dedupes_by_canonical_url(fake_db):
    await wl.enrich_wish_item("u", "n1", title="Runner X", cover_image_url=None,
                              source_domain="shop.com",
                              data=_data(buyUrl="https://shop.com/p/abc?utm_source=ig"))
    await wl.enrich_wish_item("u", "n2", title="Runner X (sale)", cover_image_url=None,
                              source_domain="shop.com",
                              data=_data(buyUrl="https://shop.com/p/abc?ref=mail"))
    assert len([k for k in fake_db.docs if k[0] == COL]) == 1  # one product, not two


async def test_urlless_product_keyed_by_brand_and_title(fake_db):
    await wl.enrich_wish_item("u", "n1", title="Mystery Gadget", cover_image_url=None,
                              source_domain=None, data={"price": "$10", "brand": "NoName"})
    key = [k for k in fake_db.docs if k[0] == COL][0]
    assert key[1].startswith("p_")
    assert "noname" in key[1] and "mystery-gadget" in key[1]


async def test_resave_does_not_clobber_user_state(fake_db):
    fake_db.seed(COL, "seed", {})  # noise
    # First save creates it in saved; promote it manually (as the endpoint would) then re-save.
    await wl.enrich_wish_item("u", "n1", title="Runner X", cover_image_url=None,
                              source_domain="shop.com", data=_data())
    item_key = [k for k in fake_db.docs if k[0] == COL and k[1] != "seed"][0]
    fake_db.docs[item_key].update({"wish_status": "purchased", "purchased_at": "earlier",
                                   "target_price": 1999.0, "price_when_added": 2499.0})
    # Re-save with a NEW (dropped) price.
    await wl.enrich_wish_item("u", "n2", title="Runner X", cover_image_url=None,
                              source_domain="shop.com", data=_data(price="₹1,799"))
    item = fake_db.docs[item_key]
    assert item["wish_status"] == "purchased"      # preserved
    assert item["purchased_at"] == "earlier"       # preserved
    assert item["target_price"] == 1999.0          # preserved
    assert item["price_when_added"] == 2499.0      # anchor preserved
    assert item["price_amount"] == 1799.0          # current price refreshed


async def test_skips_note_with_nothing_buyable(fake_db):
    # A shopping-family composer note (no price, no buyUrl) must not create a junk item.
    await wl.enrich_wish_item("u", "n1", title="Gift guide: 10 ideas", cover_image_url=None,
                              source_domain="blog.com",
                              data={"sections": [{"heading": "Ideas", "body": "..."}]})
    assert not any(k[0] == COL for k in fake_db.docs)


async def test_backfill_copies_existing_product_notes(fake_db):
    fake_db.seed("notes", "p1", {"user_id": "u", "content_type": "product",
                                 "title": "Acme Runner", "cover_image_url": "https://i/1.jpg",
                                 "source_domain": "shop.com", "data": _data()})
    fake_db.seed("notes", "g1", {"user_id": "u", "content_type": "gadget",
                                 "title": "Cool Gizmo", "data": _data(buyUrl="https://x.com/g")})
    fake_db.seed("notes", "r1", {"user_id": "u", "content_type": "recipe",
                                 "title": "Pasta", "data": {"servings": 2}})  # not shopping
    res = await wl.backfill_user("u")
    assert res == {"notes_processed": 2, "products_found": 2}
    assert len([k for k in fake_db.docs if k[0] == COL]) == 2
