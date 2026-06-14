"""POST /api/notes/{id}/save — receiver of a shared link copying it into their account."""
import pytest
from fastapi import HTTPException

import routers.notes as notes_mod


@pytest.fixture(autouse=True)
def patch_notes(fake_db, monkeypatch):
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)

    async def no_caps(db, user_id):
        return None

    async def no_embed(title, ai_summary):
        return None

    async def cats(user_id):
        return []

    async def add_cat(user_id, slug):
        fake_db.docs.setdefault(("_added_cats", user_id), []).append(slug)

    monkeypatch.setattr(notes_mod, "_enforce_cost_caps", no_caps)
    monkeypatch.setattr(notes_mod, "_note_embedding", no_embed)
    monkeypatch.setattr(notes_mod, "get_user_categories", cats)
    monkeypatch.setattr(notes_mod, "add_user_category", add_cat)


def _copy_for(fake_db, user_id):
    for (collection, _id), doc in fake_db.docs.items():
        if collection == "notes" and doc.get("user_id") == user_id:
            return _id, doc
    return None, None


async def test_save_public_note_creates_owned_copy(fake_db):
    fake_db.seed("notes", "src", {
        "user_id": "owner", "is_public": True, "title": "Tokyo trip",
        "content_type": "itinerary", "template": "itinerary",
        "ai_summary": "A weekend.", "source_url": "https://x", "source_domain": "x",
        "cover_image_url": "https://x/c.jpg", "data": {"days": [{"day": 1}]},
    })
    res = await notes_mod.save_shared_note("src", user_id="receiver")
    new_id = res["id"]
    assert new_id != "src"
    copy = fake_db.docs[("notes", new_id)]
    assert copy["user_id"] == "receiver"
    assert copy["title"] == "Tokyo trip"
    assert copy["template"] == "itinerary"          # structural schema preserved
    assert copy["source"] == "shared"
    assert copy["acquisition"] == "saved_shared"
    assert copy["source_note_ids"] == ["src"]
    assert copy["is_public"] is False               # the copy is private
    assert copy["data"]["days"][0]["day"] == 1


async def test_save_private_note_is_404(fake_db):
    fake_db.seed("notes", "src", {"user_id": "owner", "is_public": False, "title": "T"})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.save_shared_note("src", user_id="receiver")
    assert exc.value.status_code == 404
    assert _copy_for(fake_db, "receiver") == (None, None)  # nothing written


async def test_save_missing_note_is_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await notes_mod.save_shared_note("nope", user_id="receiver")
    assert exc.value.status_code == 404


async def test_save_own_note_is_noop(fake_db):
    fake_db.seed("notes", "src", {"user_id": "owner", "is_public": True, "title": "T"})
    res = await notes_mod.save_shared_note("src", user_id="owner")
    assert res["id"] == "src"                        # returns original, no duplicate
    # Only the seeded note exists — no copy created.
    note_ids = [i for (c, i) in fake_db.docs if c == "notes"]
    assert note_ids == ["src"]


async def test_save_enforces_caps(fake_db, monkeypatch):
    fake_db.seed("notes", "src", {"user_id": "owner", "is_public": True, "title": "T"})

    async def capped(db, user_id):
        raise HTTPException(429, "Note limit reached for this account.")

    monkeypatch.setattr(notes_mod, "_enforce_cost_caps", capped)
    with pytest.raises(HTTPException) as exc:
        await notes_mod.save_shared_note("src", user_id="receiver")
    assert exc.value.status_code == 429
    assert _copy_for(fake_db, "receiver") == (None, None)
