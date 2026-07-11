"""scripts/normalize_cities.py: the pure venue-list normalizer + the dry-run/apply behaviour
across both places a venue city lives (notes.data.venues and place_items)."""
import scripts.normalize_cities as nc


# --- pure ------------------------------------------------------------------------------------

def test_normalize_venues_rewrites_only_changed_entries():
    venues = [
        {"name": "Blue Tokai", "city": "Bangalore"},
        {"name": "Subko", "city": "Mumbai"},        # already canonical -> untouched
        {"name": "No City Venue"},                  # no city field at all -> untouched
        "not-a-dict",                                # malformed entry survives unchanged
    ]
    out, changed = nc.normalize_venues(venues)
    assert changed == 1
    assert out[0]["city"] == "Bengaluru"
    assert out[1]["city"] == "Mumbai"
    assert "city" not in out[2]
    assert out[3] == "not-a-dict"
    # untouched entries are the same values, not just equal (no needless copy)
    assert out[1] is venues[1]


def test_normalize_venues_no_changes_returns_zero():
    venues = [{"name": "X", "city": "Goa"}]
    out, changed = nc.normalize_venues(venues)
    assert changed == 0
    assert out == venues


# --- fake_db integration -----------------------------------------------------------------

def _prep(monkeypatch, fake_db):
    monkeypatch.setattr(nc, "get_db", lambda: fake_db)


async def test_dry_run_writes_nothing(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "place",
                                 "data": {"venues": [{"name": "X", "city": "Bangalore"}]}})
    fake_db.docs[("users/u/place_items", "g_p1")] = {"user_id": "u", "city": "Bangalore"}

    await nc.run(dry_run=True, uid=None)

    assert fake_db.docs[("notes", "n1")]["data"]["venues"][0]["city"] == "Bangalore"
    assert fake_db.docs[("users/u/place_items", "g_p1")]["city"] == "Bangalore"


async def test_apply_normalizes_note_venues(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "place",
                                 "data": {"venues": [{"name": "X", "city": "Bangalore"},
                                                     {"name": "Y", "city": "Mumbai"}]}})
    fake_db.seed("notes", "n2", {"user_id": "u", "content_type": "recipe",
                                 "data": {"servings": 2}})  # not a place note -> ignored

    await nc.run(dry_run=False, uid=None)

    venues = fake_db.docs[("notes", "n1")]["data"]["venues"]
    assert venues[0]["city"] == "Bengaluru"
    assert venues[1]["city"] == "Mumbai"  # already canonical


async def test_apply_normalizes_place_items_across_users(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.docs[("users/u1/place_items", "g_p1")] = {"user_id": "u1", "city": "Bangalore"}
    fake_db.docs[("users/u2/place_items", "g_p2")] = {"user_id": "u2", "city": "Calcutta"}

    await nc.run(dry_run=False, uid=None)

    assert fake_db.docs[("users/u1/place_items", "g_p1")]["city"] == "Bengaluru"
    assert fake_db.docs[("users/u2/place_items", "g_p2")]["city"] == "Kolkata"


async def test_uid_filter_scopes_both_collections(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u1", "content_type": "place",
                                 "data": {"venues": [{"name": "X", "city": "Bangalore"}]}})
    fake_db.seed("notes", "n2", {"user_id": "u2", "content_type": "place",
                                 "data": {"venues": [{"name": "Y", "city": "Bangalore"}]}})
    fake_db.docs[("users/u1/place_items", "g_p1")] = {"user_id": "u1", "city": "Bangalore"}
    fake_db.docs[("users/u2/place_items", "g_p2")] = {"user_id": "u2", "city": "Bangalore"}

    await nc.run(dry_run=False, uid="u1")

    assert fake_db.docs[("notes", "n1")]["data"]["venues"][0]["city"] == "Bengaluru"
    assert fake_db.docs[("notes", "n2")]["data"]["venues"][0]["city"] == "Bangalore"  # untouched
    assert fake_db.docs[("users/u1/place_items", "g_p1")]["city"] == "Bengaluru"
    assert fake_db.docs[("users/u2/place_items", "g_p2")]["city"] == "Bangalore"  # untouched
