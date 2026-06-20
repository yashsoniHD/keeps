"""DELETE /notes/{id}: ownership check + auto-retiring the note's category when it was
the last of its type. The endpoint routes through the backend (not a client Firestore
delete) precisely so this cleanup can run."""
import pytest
from fastapi import HTTPException

import routers.notes as notes_mod


@pytest.fixture(autouse=True)
def patch(fake_db, monkeypatch):
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)
    # prune_category_if_empty reads the unpatched module-level db; record its calls instead.
    pruned: list[tuple[str, str]] = []

    async def fake_prune(uid, slug):
        pruned.append((uid, slug))
        return False

    monkeypatch.setattr(notes_mod, "prune_category_if_empty", fake_prune)
    return pruned


async def test_delete_removes_note_and_offers_category_for_prune(fake_db, patch):
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "travel"})
    res = await notes_mod.delete_note("n1", user_id="u")
    assert res == {"status": "deleted"}
    assert ("notes", "n1") not in fake_db.docs       # note gone
    assert patch == [("u", "travel")]                # its type handed to the pruner


async def test_delete_rejects_non_owner_and_skips_prune(fake_db, patch):
    fake_db.seed("notes", "n1", {"user_id": "owner", "content_type": "travel"})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.delete_note("n1", user_id="intruder")
    assert exc.value.status_code == 404
    assert ("notes", "n1") in fake_db.docs           # not deleted
    assert patch == []                               # no cleanup attempted
