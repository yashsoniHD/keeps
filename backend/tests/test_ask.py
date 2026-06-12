"""Ask AI endpoint: cost caps, grounding short-circuits, citation integrity."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import routers.ask as ask_mod
from config import settings
from models.ask import AskRequest, GroundedAnswer

TODAY = datetime.now(timezone.utc).strftime("%Y%m%d")

NOTE_N1 = {
    "id": "n1", "user_id": "u", "content_type": "movie", "title": "Dune Part Two",
    "ai_summary": "Sci-fi epic.", "source_domain": "youtube",
    "cover_image_url": "https://img/x.jpg", "data": {"facts": []},
}


class FakeTransaction:
    """Just enough of google.cloud.firestore's Transaction for _enforce_ask_caps."""

    def __init__(self, db):
        self._db = db

    def set(self, ref, data, merge=False):
        base = self._db.docs.get(ref._key, {}) if merge else {}
        self._db.docs[ref._key] = {**base, **data}


@pytest.fixture(autouse=True)
def patch_ask(fake_db, monkeypatch):
    fake_db.transaction = lambda: FakeTransaction(fake_db)
    monkeypatch.setattr(ask_mod, "get_db", lambda: fake_db)
    # The real decorator needs a real Transaction; run _bump directly instead.
    monkeypatch.setattr(ask_mod.fs, "async_transactional", lambda f: f)

    async def index(db, user_id):
        return [{k: v for k, v in NOTE_N1.items() if k != "data"}]

    async def by_ids(db, user_id, ids):
        return [NOTE_N1] if "n1" in ids else []

    monkeypatch.setattr(ask_mod, "_fetch_note_index", index)
    monkeypatch.setattr(ask_mod, "_fetch_notes_by_ids", by_ids)


def _gemini(monkeypatch, select_ids, answer=None):
    """Patch both Gemini stages, recording the arguments they receive."""
    calls = {"select": [], "answer": []}

    async def select_notes(question, history, index):
        calls["select"].append(index)
        return select_ids

    async def answer_from_notes(question, history, notes):
        calls["answer"].append(notes)
        return answer or GroundedAnswer(answer_markdown="Watch Dune.", cited_note_ids=["n1"])

    monkeypatch.setattr(ask_mod.gemini_service, "select_notes", select_notes)
    monkeypatch.setattr(ask_mod.gemini_service, "answer_from_notes", answer_from_notes)
    return calls


async def test_daily_cap_hit_blocks_before_gemini(fake_db, monkeypatch):
    fake_db.seed("usage", f"u-{TODAY}", {"ask_count": settings.MAX_ASKS_PER_USER_PER_DAY})
    calls = _gemini(monkeypatch, ["n1"])
    with pytest.raises(HTTPException) as exc:
        await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    assert exc.value.status_code == 429
    assert calls["select"] == []  # cap is enforced before any paid AI call


async def test_no_notes_short_circuits_without_consuming_cap(fake_db, monkeypatch):
    async def empty_index(db, user_id):
        return []

    monkeypatch.setattr(ask_mod, "_fetch_note_index", empty_index)
    calls = _gemini(monkeypatch, ["n1"])
    res = await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    assert res.answer == ask_mod.NO_NOTES_ANSWER
    assert calls["select"] == []
    assert ("usage", f"u-{TODAY}") not in fake_db.docs  # no counter bump


async def test_happy_path_returns_answer_citations_and_bumps_counter(fake_db, monkeypatch):
    _gemini(monkeypatch, ["n1"])
    res = await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    assert res.answer == "Watch Dune."
    assert [c.id for c in res.citations] == ["n1"]
    c = res.citations[0]
    assert (c.title, c.content_type, c.cover_image_url, c.source_domain) == (
        "Dune Part Two", "movie", "https://img/x.jpg", "youtube")
    assert fake_db.docs[("usage", f"u-{TODAY}")]["ask_count"] == 1
    assert fake_db.docs[("system", f"usage-{TODAY}")]["ask_count"] == 1


async def test_hallucinated_note_ids_are_filtered(fake_db, monkeypatch):
    calls = _gemini(
        monkeypatch, ["n1", "bogus"],
        answer=GroundedAnswer(answer_markdown="Watch Dune.", cited_note_ids=["n1", "bogus"]),
    )
    res = await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    # Only the real note reaches the answering model and the citations.
    assert [n["id"] for n in calls["answer"][0]] == ["n1"]
    assert [c.id for c in res.citations] == ["n1"]
