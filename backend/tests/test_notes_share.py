"""Share / unshare endpoints: ownership enforcement + is_public toggle + link shape."""
import pytest
from fastapi import HTTPException

import routers.notes as notes_mod
from config import settings


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)


async def test_share_marks_public_and_returns_link(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T"})
    res = await notes_mod.share_note("n1", user_id="u")
    assert res["is_public"] is True
    assert res["url"] == f"{settings.PUBLIC_APP_URL}/p/n1"
    assert fake_db.docs[("notes", "n1")]["is_public"] is True


async def test_share_rejects_non_owner(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "owner", "title": "T"})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.share_note("n1", user_id="intruder")
    assert exc.value.status_code == 404
    assert "is_public" not in fake_db.docs[("notes", "n1")]  # untouched


async def test_share_missing_note_404(fake_db):
    with pytest.raises(HTTPException) as exc:
        await notes_mod.share_note("nope", user_id="u")
    assert exc.value.status_code == 404


async def test_unshare_sets_private(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "is_public": True})
    res = await notes_mod.unshare_note("n1", user_id="u")
    assert res["is_public"] is False
    assert fake_db.docs[("notes", "n1")]["is_public"] is False


async def test_unshare_rejects_non_owner(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "owner", "is_public": True})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.unshare_note("n1", user_id="intruder")
    assert exc.value.status_code == 404
    assert fake_db.docs[("notes", "n1")]["is_public"] is True  # still public
