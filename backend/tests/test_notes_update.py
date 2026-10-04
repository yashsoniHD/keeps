"""PATCH /notes/{id}: ownership, category normalisation, re-embed on edit."""
import pytest
from fastapi import HTTPException

import routers.notes as notes_mod
from services.embeddings import EMBED_TEXT_VERSION


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)
    # prune_category_if_empty reads the unpatched module-level db; record its calls instead.
    pruned: list[tuple[str, str]] = []

    async def fake_prune(uid, slug):
        pruned.append((uid, slug))
        return False

    monkeypatch.setattr(notes_mod, "prune_category_if_empty", fake_prune)
    return pruned


async def test_recategorise_collapses_to_existing_and_registers(fake_db, monkeypatch, patch_db):
    """"Recipes" with an existing "recipe" category collapses to "recipe" (no fragmenting)
    and is registered via add_user_category so it shows in filters + trains the classifier.
    The note's old type ("summary") is offered for pruning in case it was its last note."""
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
    assert patch_db == [("u", "summary")]  # old type handed to the pruner


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
        await notes_mod.update_note("n1", notes_mod.NoteUpdate(title="x"), user_id="intruder")
    assert exc.value.status_code == 404


async def test_missing_note_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await notes_mod.update_note("nope", notes_mod.NoteUpdate(title="x"), user_id="u")
    assert exc.value.status_code == 404


async def test_data_edit_reembeds(fake_db):
    """A body/data edit (not just title/summary) must refresh the search vector + index entry,
    stamped with the current embedding_version, so search reflects the new content."""
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Butter chicken",
                                 "ai_summary": "Curry.", "data": {"ingredients": ["old"]}})
    await notes_mod.update_note(
        "n1", notes_mod.NoteUpdate(data={"ingredients": ["garam masala"]}), user_id="u")

    note = fake_db.docs[("notes", "n1")]
    assert note["data"] == {"ingredients": ["garam masala"]}
    assert note["embedding"] is not None
    assert note["embedding_version"] == EMBED_TEXT_VERSION


async def _noop():
    return None
