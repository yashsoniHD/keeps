"""Clipnote Agent: leaf tools, dispatch budgets/gating, SSRF, and additive note merge."""
from datetime import datetime, timezone

import pytest

from google.genai import types

import services.agent_tools as at
from config import settings
from routers.notes import _merge_blocks


def _ctx(**kw):
    base = dict(db=None, user_id="u", question="q", history=[], pool=[],
                tz_offset_minutes=0, now_utc=datetime.now(timezone.utc))
    base.update(kw)
    return at.AgentContext(**base)


# ── run_agent: silent-empty-answer retry + error (issue #1) ───────────────────

class _FakeResponse:
    def __init__(self, text):
        self.text = text
        self.usage_metadata = None  # no meter → record_usage no-ops


class _FakeModels:
    """Stand-in for client.aio.models. `rounds` is a list of per-stream-call chunk lists;
    `final_text` is what the tool-free retry generate returns."""
    def __init__(self, rounds, final_text):
        self.rounds = rounds
        self.final_text = final_text
        self.stream_calls = 0
        self.gen_calls = 0

    async def generate_content_stream(self, **_kw):
        idx = self.stream_calls
        self.stream_calls += 1
        chunks = self.rounds[idx] if idx < len(self.rounds) else []

        async def _gen():
            for c in chunks:
                yield c

        return _gen()

    async def generate_content(self, **_kw):
        self.gen_calls += 1
        return _FakeResponse(self.final_text)


class _FakeClient:
    def __init__(self, models):
        self.aio = type("Aio", (), {"models": models})()


def _chunk(parts):
    """Wrap real genai Parts in the minimal candidates/content shape _chunk_parts reads."""
    content = type("C", (), {"parts": parts})()
    cand = type("Cand", (), {"content": content})()
    return type("Chunk", (), {"candidates": [cand]})()


def _fc_part(name="search_notes", args=None):
    # A REAL function-call Part — run_agent re-appends it into `contents` (validated by genai).
    return types.Part(function_call=types.FunctionCall(name=name, args=args or {"query": "q"}))


def _text_part(text):
    return types.Part(text=text)


def _install_models(monkeypatch, rounds, final_text):
    async def _fake_dispatch(name, args, ctx):
        return {"count": 0, "notes": []}

    monkeypatch.setattr(at, "dispatch", _fake_dispatch)
    monkeypatch.setattr(settings, "ASK_ENABLE_TOOLS", True)
    models = _FakeModels(rounds, final_text)
    monkeypatch.setattr(at.gemini_service, "client", _FakeClient(models))
    return models


async def _collect(ctx):
    return [ev async for ev in at.run_agent(ctx)]


async def test_run_agent_retries_then_errors_when_still_empty(monkeypatch):
    # Round 0 calls a tool (no text); round 1 (last) returns nothing → retry runs → retry
    # ALSO empty → a single friendly error event, never a silent finish.
    models = _install_models(monkeypatch, rounds=[[_chunk([_fc_part()])], []], final_text="")
    events = await _collect(_ctx(max_rounds=2))

    assert models.gen_calls == 1, "the tool-free retry generate must run exactly once"
    assert not any(e["type"] == "delta" for e in events)
    errors = [e for e in events if e["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["message"] == at.NO_ANSWER_MESSAGE


async def test_run_agent_retry_recovers_with_text(monkeypatch):
    # Same empty-final-round path, but the retry produces text → one delta, no error.
    models = _install_models(monkeypatch, rounds=[[_chunk([_fc_part()])], []],
                             final_text="Here is your Turkey plan.")
    events = await _collect(_ctx(max_rounds=2))

    assert models.gen_calls == 1
    deltas = [e for e in events if e["type"] == "delta"]
    assert deltas and deltas[-1]["text"] == "Here is your Turkey plan."
    assert not any(e["type"] == "error" for e in events)


async def test_run_agent_normal_path_unchanged(monkeypatch):
    # Model answers with text on the first round → no retry, no error (contract intact).
    models = _install_models(monkeypatch, rounds=[[_chunk([_text_part("Hello!")])]],
                             final_text="SHOULD NOT BE USED")
    events = await _collect(_ctx(max_rounds=2))

    assert models.gen_calls == 0, "a normal answer must not trigger the retry generate"
    assert [e for e in events if e["type"] == "delta"] == [{"type": "delta", "text": "Hello!"}]
    assert not any(e["type"] == "error" for e in events)


# ── initial contents (date + dated, labelled preview) ────────────────────────
def test_initial_contents_injects_local_date_and_dated_preview():
    pool = [{"id": "n1", "content_type": "recipe", "title": "Soup",
             "ai_summary": "", "created_at": datetime(2026, 6, 16, tzinfo=timezone.utc)}]
    ctx = _ctx(pool=pool, now_utc=datetime(2026, 6, 16, 12, 0, tzinfo=timezone.utc))
    text = at._initial_contents(ctx)[0].parts[0].text
    assert "current local date is 2026-06-16" in text
    assert "NON-EXHAUSTIVE preview" in text  # preview labelled, not the answer set
    assert "2026-06-16 · recipe · Soup" in text  # saved-date is shown so dates are reasonable


# ── leaf tools ──────────────────────────────────────────────────────────────

def test_maps_link_encodes_place_and_locality():
    out = at.maps_link("Gymkhana", "London")
    assert out["url"] == "https://www.google.com/maps/search/?api=1&query=Gymkhana+London"


def test_maps_link_requires_place():
    assert "error" in at.maps_link("", "")


def test_directions_link_builds_url():
    out = at.directions_link("Lisbon Airport", "Alfama")
    assert "origin=Lisbon+Airport" in out["url"] and "destination=Alfama" in out["url"]


@pytest.mark.parametrize("expr,expected", [("120*1.85+30", 252.0), ("(2/2)*4", 4.0), ("10-3", 7)])
def test_compute_evaluates_arithmetic(expr, expected):
    assert at.compute(expr)["result"] == expected


@pytest.mark.parametrize("expr", ['__import__("os").system("ls")', "a+1", "1/", "open('x')", "1;2"])
def test_compute_rejects_unsafe(expr):
    assert "error" in at.compute(expr)


# ── dispatch: budgets, gating, unknown ────────────────────────────────────────

async def test_dispatch_unknown_tool_returns_error():
    res = await at.dispatch("nonsense", {}, _ctx())
    assert "error" in res and "unknown" in res["error"]


async def test_dispatch_tool_budget_forces_stop():
    ctx = _ctx()
    ctx.tool_calls = settings.MAX_TOOL_CALLS_PER_ASK  # next call exceeds the cap
    res = await at.dispatch("maps_link", {"place": "x"}, ctx)
    assert "error" in res and "budget" in res["error"]


async def test_dispatch_web_tool_disabled_by_default(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_WEB_TOOLS", False)
    res = await at.dispatch("research_web", {"query": "x"}, _ctx())
    assert res == {"error": "web tools are disabled"}


async def test_fetch_url_blocks_metadata_ip():
    # Link-local metadata IP must be refused by the SSRF guard, not fetched.
    res = await at.fetch_url("http://169.254.169.254/latest/meta-data/")
    assert "error" in res and "block" in res["error"].lower()


def test_web_tools_declared_only_when_enabled(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_WEB_TOOLS", False)
    assert "research_web" not in {d.name for d in at._tool_declarations()}
    monkeypatch.setattr(settings, "ENABLE_WEB_TOOLS", True)
    names = {d.name for d in at._tool_declarations()}
    assert {"research_web", "fetch_url"} <= names


async def test_research_web_dispatches_when_enabled(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_WEB_TOOLS", True)

    async def fake_research(query):
        return f"FACTS about {query}"

    monkeypatch.setattr(at.gemini_service, "web_research", fake_research)
    res = await at.dispatch("research_web", {"query": "EUR to USD rate"}, _ctx())
    assert res["result"] == "FACTS about EUR to USD rate"


# ── additive note merge (augment) ─────────────────────────────────────────────

def test_merge_blocks_appends_lists_and_preserves_existing():
    existing = {"sections": [{"heading": "Day 1", "items": ["A"]}], "title_kept": "x"}
    incoming = {"sections": [{"heading": "Where to stay", "items": ["Hotel"]}],
                "checklist": ["passport"]}
    merged = _merge_blocks(existing, incoming)
    assert len(merged["sections"]) == 2
    assert merged["checklist"] == ["passport"]
    assert merged["title_kept"] == "x"  # untouched


def test_merge_blocks_table_same_columns_appends_rows():
    existing = {"table": {"columns": ["a", "b"], "rows": [[1, 2]]}}
    incoming = {"table": {"columns": ["a", "b"], "rows": [[3, 4]]}}
    merged = _merge_blocks(existing, incoming)
    assert merged["table"]["rows"] == [[1, 2], [3, 4]]


def test_merge_blocks_table_diff_columns_kept_separately():
    existing = {"table": {"columns": ["a"], "rows": [[1]]}}
    incoming = {"table": {"columns": ["x", "y"], "rows": [[1, 2]]}}
    merged = _merge_blocks(existing, incoming)
    assert merged["table"]["columns"] == ["a"]      # original preserved
    assert merged["table_added"]["columns"] == ["x", "y"]
