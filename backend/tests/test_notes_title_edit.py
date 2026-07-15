"""PATCH /api/notes/{id} — owner renaming a note's title (#9)."""
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import routers.notes as notes_mod
from routers.notes import NoteUpdate


@pytest.fixture(autouse=True)
def patch_notes(fake_db, monkeypatch):
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)

    embedded: list[tuple[str, str]] = []

    async def fake_embed(title, ai_summary, data=None):
        embedded.append((title, ai_summary))
        return [0.1, 0.2, 0.3]

    monkeypatch.setattr(notes_mod, "_note_embedding", fake_embed)
    fake_db.embedded = embedded  # surface for assertions
    return fake_db


async def test_title_update_writes_and_reembeds(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "old", "ai_summary": "a summary"})

    res = await notes_mod.update_note("n1", NoteUpdate(title="A New Title"), user_id="u")
    assert res == {"ok": True}

    note = fake_db.docs[("notes", "n1")]
    assert note["title"] == "A New Title"
    assert "updated_at" in note
    assert note["embedding"] == [0.1, 0.2, 0.3]
    # Re-embed uses the new title + the existing summary.
    assert fake_db.embedded == [("A New Title", "a summary")]


async def test_title_is_stripped(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "old", "ai_summary": ""})
    await notes_mod.update_note("n1", NoteUpdate(title="  Trimmed  "), user_id="u")
    assert fake_db.docs[("notes", "n1")]["title"] == "Trimmed"


async def test_empty_title_rejected(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "old", "ai_summary": ""})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.update_note("n1", NoteUpdate(title="   "), user_id="u")
    assert exc.value.status_code == 422
    assert fake_db.docs[("notes", "n1")]["title"] == "old"  # unchanged


async def test_oversized_title_rejected_at_model():
    with pytest.raises(ValidationError):
        NoteUpdate(title="x" * 301)


async def test_non_owner_gets_404(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "owner", "title": "old", "ai_summary": ""})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.update_note("n1", NoteUpdate(title="hacked"), user_id="intruder")
    assert exc.value.status_code == 404
    assert fake_db.docs[("notes", "n1")]["title"] == "old"
