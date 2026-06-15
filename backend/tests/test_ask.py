"""Ask AI endpoint: cost caps, plan-based routing, general chat, citations, coverage."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import routers.ask as ask_mod
import services.note_retrieval as nr
from config import settings
from models.ask import ArtifactNote, AskPlan, AskRequest, GroundedAnswer, SynthAnswer

TODAY = datetime.now(timezone.utc).strftime("%Y%m%d")

NOTE_N1 = {
    "id": "n1", "user_id": "u", "content_type": "movie", "title": "Dune Part Two",
    "ai_summary": "Sci-fi epic.", "source_domain": "youtube",
    "cover_image_url": "https://img/x.jpg", "data": {"facts": []},
}
INDEX_N1 = {k: v for k, v in NOTE_N1.items() if k != "data"}


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

    async def pool(db, user_id, question):
        return [INDEX_N1]

    async def by_ids(db, user_id, ids):
        return [NOTE_N1] if "n1" in ids else []

    monkeypatch.setattr(nr, "candidate_pool", pool)
    monkeypatch.setattr(nr, "fetch_notes_by_ids", by_ids)


def _gemini(monkeypatch, plan, answer=None, chat=None, synth=None, created=None):
    """Patch the planner + answer/chat/synth/create stages, recording the args they receive."""
    calls = {"plan": [], "answer": [], "chat": [], "synth": [], "create": []}

    async def plan_ask(question, history, today, index):
        calls["plan"].append(index)
        return plan

    async def answer_from_notes(question, history, notes, focal_title=None):
        calls["answer"].append(notes)
        calls.setdefault("focal", []).append(focal_title)
        return answer or GroundedAnswer(answer_markdown="Watch Dune.", cited_note_ids=["n1"])

    async def answer_chat(question, history):
        calls["chat"].append(question)
        return chat or GroundedAnswer(answer_markdown="Paris is the capital of France.")

    async def synthesize(question, history, notes, output, focal_title=None):
        calls["synth"].append(output)
        calls.setdefault("focal", []).append(focal_title)
        return synth or SynthAnswer(answer_markdown="Here it is:",
                                    artifact=ArtifactNote(title="Artifact"), cited_note_ids=["n1"])

    async def create_note(question, history):
        calls["create"].append(question)
        return created or ArtifactNote(title="Draft", origin="created")

    monkeypatch.setattr(ask_mod.gemini_service, "plan_ask", plan_ask)
    monkeypatch.setattr(ask_mod.gemini_service, "answer_from_notes", answer_from_notes)
    monkeypatch.setattr(ask_mod.gemini_service, "answer_chat", answer_chat)
    monkeypatch.setattr(ask_mod.gemini_service, "synthesize", synthesize)
    monkeypatch.setattr(ask_mod.gemini_service, "create_note", create_note)
    return calls


async def test_daily_cap_hit_blocks_before_gemini(fake_db, monkeypatch):
    fake_db.seed("usage", f"u-{TODAY}", {"ask_count": settings.MAX_ASKS_PER_USER_PER_DAY})
    calls = _gemini(monkeypatch, AskPlan(scope="notes", note_ids=["n1"]))
    with pytest.raises(HTTPException) as exc:
        await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    assert exc.value.status_code == 429
    assert calls["plan"] == []  # cap is enforced before any paid AI call


async def test_semantic_happy_path(fake_db, monkeypatch):
    _gemini(monkeypatch, AskPlan(scope="notes", note_ids=["n1"]))
    res = await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    assert res.answer == "Watch Dune."
    assert [c.id for c in res.citations] == ["n1"]
    c = res.citations[0]
    assert (c.title, c.content_type, c.cover_image_url, c.source_domain) == (
        "Dune Part Two", "movie", "https://img/x.jpg", "youtube")
    assert res.coverage is None
    assert fake_db.docs[("usage", f"u-{TODAY}")]["ask_count"] == 1
    assert fake_db.docs[("system", f"usage-{TODAY}")]["ask_count"] == 1


async def test_general_scope_answers_without_notes(fake_db, monkeypatch):
    calls = _gemini(monkeypatch, AskPlan(scope="general"))
    res = await ask_mod.ask(AskRequest(question="capital of France?"), user_id="u")
    assert res.answer == "Paris is the capital of France."
    assert res.citations == []  # general chat never cites notes
    assert calls["answer"] == []  # the grounded stage is skipped entirely
    assert calls["chat"] == ["capital of France?"]


async def test_hallucinated_note_ids_are_filtered(fake_db, monkeypatch):
    calls = _gemini(
        monkeypatch, AskPlan(scope="notes", note_ids=["n1", "bogus"]),
        answer=GroundedAnswer(answer_markdown="Watch Dune.", cited_note_ids=["n1", "bogus"]),
    )
    res = await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    assert [n["id"] for n in calls["answer"][0]] == ["n1"]  # only real notes reach the model
    assert [c.id for c in res.citations] == ["n1"]


async def test_temporal_routes_to_window_query(fake_db, monkeypatch):
    seen = {}

    async def window(db, user_id, after, before, cap):
        seen["after"], seen["before"] = after, before
        return [NOTE_N1]

    monkeypatch.setattr(nr, "fetch_notes_by_window", window)
    calls = _gemini(monkeypatch, AskPlan(scope="notes", period="today"))
    res = await ask_mod.ask(AskRequest(question="summarize today's notes"), user_id="u")
    assert res.answer == "Watch Dune."
    assert [n["id"] for n in calls["answer"][0]] == ["n1"]  # came from the window, not note_ids
    assert seen["after"] < seen["before"]


async def test_temporal_empty_returns_period_message(fake_db, monkeypatch):
    async def window(db, user_id, after, before, cap):
        return []

    monkeypatch.setattr(nr, "fetch_notes_by_window", window)
    _gemini(monkeypatch, AskPlan(scope="notes", period="yesterday"))
    res = await ask_mod.ask(AskRequest(question="what did I save yesterday"), user_id="u")
    assert res.answer == "You didn't save anything yesterday."


async def test_exhaustive_by_type_fetches_full_set(fake_db, monkeypatch):
    async def by_types(db, user_id, types, cap):
        assert types == ["recipe"]
        return [NOTE_N1, {**NOTE_N1, "id": "n2"}]

    monkeypatch.setattr(nr, "fetch_notes_by_types", by_types)
    calls = _gemini(
        monkeypatch,
        AskPlan(scope="notes", content_types=["recipe"], exhaustive=True),
        answer=GroundedAnswer(answer_markdown="Two recipes.", cited_note_ids=["n1", "n2"]),
    )
    res = await ask_mod.ask(AskRequest(question="all my recipes"), user_id="u")
    assert {n["id"] for n in calls["answer"][0]} == {"n1", "n2"}
    assert res.answer == "Two recipes."


async def test_coverage_reported_when_capped(fake_db, monkeypatch):
    monkeypatch.setattr(settings, "ASK_MAX_GROUNDED_NOTES", 2)

    async def window(db, user_id, after, before, cap):
        return [{**NOTE_N1, "id": f"n{i}"} for i in range(3)]  # 3 matched, cap 2

    monkeypatch.setattr(nr, "fetch_notes_by_window", window)
    _gemini(monkeypatch, AskPlan(scope="notes", period="this_week"),
            answer=GroundedAnswer(answer_markdown="ok", cited_note_ids=[]))
    res = await ask_mod.ask(AskRequest(question="this week"), user_id="u")
    assert res.coverage == "Based on 2 of 3 matching notes."


async def test_zero_notes_notes_scope_short_circuits(fake_db, monkeypatch):
    async def empty_pool(db, user_id, question):
        return []

    monkeypatch.setattr(nr, "candidate_pool", empty_pool)
    _gemini(monkeypatch, AskPlan(scope="notes", note_ids=[]))
    res = await ask_mod.ask(AskRequest(question="what to watch"), user_id="u")
    assert res.answer == ask_mod.NO_NOTES_ANSWER


async def test_source_filter_routes_to_source_fetch(fake_db, monkeypatch):
    async def by_source(db, user_id, source, cap):
        assert source == "pinterest"
        return [NOTE_N1]

    monkeypatch.setattr(nr, "fetch_notes_by_source", by_source)
    calls = _gemini(monkeypatch, AskPlan(scope="notes", source="pinterest"))
    res = await ask_mod.ask(AskRequest(question="find my pinterest note"), user_id="u")
    assert [n["id"] for n in calls["answer"][0]] == ["n1"]  # came from the source fetch
    assert res.answer == "Watch Dune."


async def test_source_empty_returns_specific_message(fake_db, monkeypatch):
    async def by_source(db, user_id, source, cap):
        return []

    monkeypatch.setattr(nr, "fetch_notes_by_source", by_source)
    _gemini(monkeypatch, AskPlan(scope="notes", source="pinterest"))
    res = await ask_mod.ask(AskRequest(question="find my pinterest note"), user_id="u")
    assert res.answer == "I couldn't find any notes from pinterest."


async def test_open_ended_miss_falls_back_to_general(fake_db, monkeypatch):
    # Planner mis-tagged a general question as note-scoped, and nothing matched: rather than
    # dead-ending with "couldn't find anything in your notes", answer it generally.
    calls = _gemini(monkeypatch, AskPlan(scope="notes", note_ids=[]))
    res = await ask_mod.ask(AskRequest(question="tell me a joke"), user_id="u")
    assert res.answer == "Paris is the capital of France."  # stubbed general chat
    assert res.citations == []
    assert calls["chat"] == ["tell me a joke"]
    assert calls["answer"] == []


async def test_consolidation_returns_artifact_and_skips_prose(fake_db, monkeypatch):
    art = ArtifactNote(
        title="3 days in Tokyo", ai_summary="A packed weekend.", content_type="itinerary",
        data={"sections": [{"heading": "Day 1", "items": ["Tsukiji breakfast"]}]},
    )
    calls = _gemini(
        monkeypatch,
        AskPlan(scope="notes", note_ids=["n1"], output="itinerary", exhaustive=True),
        synth=SynthAnswer(answer_markdown="Here's your trip:", artifact=art, cited_note_ids=["n1"]),
    )
    res = await ask_mod.ask(
        AskRequest(question="consolidate my trip notes into an itinerary"), user_id="u"
    )
    assert res.artifact is not None
    assert res.artifact.title == "3 days in Tokyo"
    assert res.artifact.data["sections"][0]["heading"] == "Day 1"
    assert res.answer == "Here's your trip:"
    assert [c.id for c in res.citations] == ["n1"]
    assert calls["synth"] == ["itinerary"]
    assert calls["answer"] == []  # prose answerer skipped for artifact output


async def test_create_intent_returns_draft_artifact(fake_db, monkeypatch):
    art = ArtifactNote(
        title="Lisbon cafes", content_type="cafes",
        data={"checklist": ["Fábrica Coffee", "Copenhagen Coffee Lab"]}, origin="created",
    )
    calls = _gemini(monkeypatch, AskPlan(intent="create", scope="notes"), created=art)
    res = await ask_mod.ask(AskRequest(question="make a note about Lisbon cafes"), user_id="u")
    assert res.artifact is not None
    assert res.artifact.origin == "created"
    assert res.artifact.title == "Lisbon cafes"
    assert calls["create"] == ["make a note about Lisbon cafes"]
    assert calls["answer"] == [] and calls["synth"] == []  # no retrieval/answer for create


async def test_zero_notes_general_scope_still_answers(fake_db, monkeypatch):
    async def empty_pool(db, user_id, question):
        return []

    monkeypatch.setattr(nr, "candidate_pool", empty_pool)
    _gemini(monkeypatch, AskPlan(scope="general"))
    res = await ask_mod.ask(AskRequest(question="hello"), user_id="u")
    assert res.answer == "Paris is the capital of France."  # the stubbed chat reply
    assert res.citations == []


async def test_note_context_forces_scope_and_grounds_in_focal(fake_db, monkeypatch):
    # Opened from a note: even a "general" plan must ground in that note, not chat freely.
    calls = _gemini(monkeypatch, AskPlan(scope="general"))
    res = await ask_mod.ask(AskRequest(question="summarize this", note_id="n1"), user_id="u")
    assert [n["id"] for n in calls["answer"][0]] == ["n1"]  # focal note grounded
    assert calls["chat"] == []                              # general path overridden
    assert calls["focal"][-1] == "Dune Part Two"            # title hint passed to the model
    assert [c.id for c in res.citations] == ["n1"]


async def test_note_context_ranks_focal_ahead_of_planner_picks(fake_db, monkeypatch):
    note2 = {"id": "n2", "user_id": "u", "content_type": "recipe", "title": "Pasta",
             "ai_summary": "x", "source_domain": "web", "data": {}}

    async def pool(db, user_id, question):
        return [{k: v for k, v in note2.items() if k != "data"}]  # pool knows only n2

    async def by_ids(db, user_id, ids):
        return [n for n in (NOTE_N1, note2) if n["id"] in ids]

    monkeypatch.setattr(nr, "candidate_pool", pool)
    monkeypatch.setattr(nr, "fetch_notes_by_ids", by_ids)
    calls = _gemini(monkeypatch, AskPlan(scope="notes", note_ids=["n2"]),
                    answer=GroundedAnswer(answer_markdown="ok", cited_note_ids=["n1", "n2"]))
    res = await ask_mod.ask(AskRequest(question="how does this compare", note_id="n1"), user_id="u")
    assert [n["id"] for n in calls["answer"][0]] == ["n1", "n2"]  # focal first, then matches
    assert res.coverage is None


async def test_foreign_or_missing_note_id_is_ignored(fake_db, monkeypatch):
    # A stale/foreign id must not error the chat or inject a focal hint.
    calls = _gemini(monkeypatch, AskPlan(scope="notes", note_ids=["n1"]))
    res = await ask_mod.ask(AskRequest(question="what to watch", note_id="not-mine"), user_id="u")
    assert [c.id for c in res.citations] == ["n1"]
    assert calls["focal"][-1] is None  # no focal note → no hint


@pytest.mark.parametrize(
    "value,expected",
    [
        ("pin.it", "pinterest"),          # Pinterest short link — the reported bug
        ("in.pinterest.com", "pinterest"),
        ("pinterest", "pinterest"),       # the user's keyword
        ("youtu.be", "youtube"),
        ("x.com", "twitter"),
        ("amzn.in", "amazon"),
        ("open.substack.com", "substack"),
        ("somerandomblog.dev", "somerandomblog"),  # registrable-label fallback
    ],
)
def test_canonical_source_resolves_short_links(value, expected):
    from services.source_alias import canonical_source
    assert canonical_source(value) == expected


async def test_source_fetch_matches_short_link_domain(fake_db, monkeypatch):
    """'find my Pinterest notes' must match a note saved from a pin.it short link."""
    docs = [
        {"id": "pin1", "source_domain": "pin.it", "title": "Mango sago"},
        {"id": "yt1", "source_domain": "youtu.be", "title": "Dune"},
    ]

    class FakeDoc:
        def __init__(self, d):
            self.id = d["id"]
            self._d = d

        def to_dict(self):
            return self._d

    class FakeStream:
        def __aiter__(self):
            async def gen():
                for d in docs:
                    yield FakeDoc(d)
            return gen()

    class FakeQuery:
        def where(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def limit(self, *a, **k):
            return self

        def stream(self):
            return FakeStream()

    class FakeDB:
        def collection(self, *a, **k):
            return FakeQuery()

    matched = await ask_mod._fetch_notes_by_source(FakeDB(), "u", "pinterest", cap=10)
    assert [n["id"] for n in matched] == ["pin1"]
