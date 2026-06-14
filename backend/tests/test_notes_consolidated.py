"""POST /api/notes/consolidated — saving an Ask-AI artifact as a note."""
import pytest

import routers.notes as notes_mod
from models.note import ContentBundle  # noqa: F401  (ensures models import cleanly)
from routers.notes import ConsolidatedNoteIn


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


def _saved_note(fake_db):
    for (collection, _id), doc in fake_db.docs.items():
        if collection == "notes":
            return doc
    return None


async def test_consolidated_note_is_written_with_composed_template(fake_db):
    body = ConsolidatedNoteIn(
        title="3 days in Tokyo",
        ai_summary="A packed weekend.",
        content_type="itinerary",
        data={"sections": [{"heading": "Day 1", "items": ["Tsukiji breakfast"]}]},
        source_note_ids=["n1", "n2"],
    )
    res = await notes_mod.create_consolidated_note(body, user_id="u")
    assert "id" in res

    note = _saved_note(fake_db)
    assert note["user_id"] == "u"
    assert note["template"] == "composed"        # forces GenericNote rendering
    assert note["source"] == "ai"
    assert note["acquisition"] == "ai_consolidated"
    assert note["source_note_ids"] == ["n1", "n2"]
    assert note["data"]["sections"][0]["heading"] == "Day 1"
    # content_type is normalized but kept for the category pill.
    assert note["content_type"] == "itinerary"


async def test_created_origin_sets_provenance(fake_db):
    body = ConsolidatedNoteIn(title="Lisbon cafes", content_type="cafes", origin="created")
    await notes_mod.create_consolidated_note(body, user_id="u")
    note = _saved_note(fake_db)
    assert note["acquisition"] == "ai_created"
    assert note["source"] == "ai"


async def test_consolidated_note_caps_are_enforced(fake_db, monkeypatch):
    from fastapi import HTTPException

    async def capped(db, user_id):
        raise HTTPException(429, "Note limit reached for this account.")

    monkeypatch.setattr(notes_mod, "_enforce_cost_caps", capped)
    with pytest.raises(HTTPException) as exc:
        await notes_mod.create_consolidated_note(
            ConsolidatedNoteIn(title="x"), user_id="u"
        )
    assert exc.value.status_code == 429
    assert _saved_note(fake_db) is None  # nothing written when capped
