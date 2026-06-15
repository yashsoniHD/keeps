"""Persistent chat history: persist/resume, list/get/delete, and the per-user cap."""
import pytest

import services.conversations as convo
from config import settings


async def test_persist_creates_and_resumes(fake_db):
    cid = await convo.persist_exchange(fake_db, "u", None, "What are my recipes?",
                                       {"text": "You have 3.", "citations": [], "artifact": None})
    assert cid
    got = await convo.get_conversation(fake_db, "u", cid)
    assert got["title"] == "What are my recipes?"
    assert len(got["messages"]) == 2  # user + assistant

    # Resuming with the same cid appends, keeps the title.
    cid2 = await convo.persist_exchange(fake_db, "u", cid, "And my trips?",
                                        {"text": "2 trips.", "citations": [], "artifact": None})
    assert cid2 == cid
    got = await convo.get_conversation(fake_db, "u", cid)
    assert len(got["messages"]) == 4
    assert got["title"] == "What are my recipes?"


async def test_list_and_delete(fake_db):
    cid = await convo.persist_exchange(fake_db, "u", None, "hello", {"text": "hi"})
    listed = await convo.list_conversations(fake_db, "u")
    assert [c["id"] for c in listed] == [cid]
    await convo.delete_conversation(fake_db, "u", cid)
    assert await convo.get_conversation(fake_db, "u", cid) is None


async def test_messages_are_user_scoped(fake_db):
    cid = await convo.persist_exchange(fake_db, "u", None, "mine", {"text": "ok"})
    # A different user sees nothing and can't open it.
    assert await convo.list_conversations(fake_db, "other") == []
    assert await convo.get_conversation(fake_db, "other", cid) is None


async def test_conversation_cap_evicts_oldest(fake_db, monkeypatch):
    monkeypatch.setattr(settings, "MAX_CONVERSATIONS_PER_USER", 2)
    for i in range(3):
        await convo.persist_exchange(fake_db, "u", None, f"chat {i}", {"text": "ok"})
    listed = await convo.list_conversations(fake_db, "u")
    assert len(listed) == 2  # oldest evicted on the 3rd create
