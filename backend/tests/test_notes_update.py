"""PATCH /notes/{id}: ownership, private annotation isolation, category normalisation."""
import pytest
from fastapi import HTTPException

import routers.notes as notes_mod


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)


async def test_user_note_stored_off_note_in_owner_only_doc(fake_db):
    """The private annotation must NOT land on the note (which can be made public);
    it goes to annotations/{id} with the owner's uid."""
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T"})
    res = await notes_mod.update_note("n1", notes_mod.NoteUpdate(user_note="cook for Diwali"), user_id="u")
    assert res == {"ok": True}
    assert "user_note" not in fake_db.docs[("notes", "n1")]
    assert fake_db.docs[("annotations", "n1")]["user_note"] == "cook for Diwali"
    assert fake_db.docs[("annotations", "n1")]["user_id"] == "u"


async def test_recategorise_collapses_to_existing_and_registers(fake_db, monkeypatch):
    """"Recipes" with an existing "recipe" category collapses to "recipe" (no fragmenting)
    and is registered via add_user_category so it shows in filters + trains the classifier."""
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "summary"})
    calls: list[tuple[str, str]] = []

    async def fake_get_cats(uid):
        return ["recipe"]

    async def fake_add(uid, slug):
        calls.append((uid, slug))

    monkeypatch.setattr(notes_mod, "get_user_categories", fake_get_cats)
    monkeypatch.setattr(notes_mod, "add_user_category", fake_add)

    await notes_mod.update_note("n1", notes_mod.NoteUpdate(content_type="Recipes"), user_id="u")
    assert fake_db.docs[("notes", "n1")]["content_type"] == "recipe"
    assert calls == [("u", "recipe")]


async def test_new_category_kept_as_slug(fake_db, monkeypatch):
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "summary"})

    async def fake_get_cats(uid):
        return ["recipe"]

    monkeypatch.setattr(notes_mod, "get_user_categories", fake_get_cats)
    monkeypatch.setattr(notes_mod, "add_user_category", lambda uid, slug: _noop())

    await notes_mod.update_note("n1", notes_mod.NoteUpdate(content_type="Work Stuff"), user_id="u")
    assert fake_db.docs[("notes", "n1")]["content_type"] == "work-stuff"


async def test_rejects_non_owner(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "owner"})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.update_note("n1", notes_mod.NoteUpdate(user_note="x"), user_id="intruder")
    assert exc.value.status_code == 404
    assert ("annotations", "n1") not in fake_db.docs  # nothing written


async def test_missing_note_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await notes_mod.update_note("nope", notes_mod.NoteUpdate(user_note="x"), user_id="u")
    assert exc.value.status_code == 404


async def _noop():
    return None
