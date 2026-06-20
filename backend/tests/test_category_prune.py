"""prune_category_if_empty: the decision that powers auto-removal. Keep a category while any
note of its type remains; drop it (slug + icon/colour meta) once the last one is gone. The
note-existence check is exercised for real against the in-memory store; the array/meta writes
are recorded (the double doesn't interpret ArrayRemove/DELETE_FIELD sentinels)."""
import pytest

import services.firebase as fb


@pytest.fixture
def removed(fake_db, monkeypatch):
    monkeypatch.setattr(fb, "get_db", lambda: fake_db)
    log: list[tuple[str, str, str]] = []

    async def rec_cat(uid, slug):
        log.append(("category", uid, slug))

    async def rec_meta(uid, slug):
        log.append(("meta", uid, slug))

    monkeypatch.setattr(fb, "remove_user_category", rec_cat)
    monkeypatch.setattr(fb, "remove_category_meta", rec_meta)
    return log


async def test_keeps_category_with_a_remaining_note(fake_db, removed):
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "travel"})
    assert await fb.prune_category_if_empty("u", "travel") is False
    assert removed == []


async def test_removes_category_when_last_note_gone(fake_db, removed):
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "recipe"})  # different type
    assert await fb.prune_category_if_empty("u", "travel") is True
    assert removed == [("category", "u", "travel"), ("meta", "u", "travel")]


async def test_another_users_note_does_not_keep_it_alive(fake_db, removed):
    fake_db.seed("notes", "n1", {"user_id": "other", "content_type": "travel"})
    assert await fb.prune_category_if_empty("u", "travel") is True
    assert removed == [("category", "u", "travel"), ("meta", "u", "travel")]


async def test_empty_slug_is_a_noop(fake_db, removed):
    assert await fb.prune_category_if_empty("u", "") is False
    assert removed == []
