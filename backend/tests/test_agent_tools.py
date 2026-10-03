"""Clipnote Agent: leaf tools, dispatch budgets/gating, SSRF, and additive note merge."""
from datetime import datetime, timezone

from types import SimpleNamespace

import pytest

import services.agent_tools as at
from config import settings
from conftest import chat_resp
from routers.notes import _merge_blocks


def _ctx(**kw):
    base = dict(db=None, user_id="u", question="q", history=[], pool=[],
                tz_offset_minutes=0, now_utc=datetime.now(timezone.utc))
    base.update(kw)
    return at.AgentContext(**base)


# ── run_agent: silent-empty-answer retry + error (issue #1) ───────────────────

class _FakeCompletions:
    """Stand-in for aclient.chat.completions. `rounds` is a list of per-stream-call chunk
    lists; `final_text` is what the tool-free (non-stream) retry completion returns."""
    def __init__(self, rounds, final_text):
        self.rounds = rounds
        self.final_text = final_text
        self.stream_calls = 0
        self.gen_calls = 0
        self.calls: list[dict] = []

    async def create(self, **kw):
        self.calls.append(kw)
        if not kw.get("stream"):
            self.gen_calls += 1
            return chat_resp(self.final_text)
        idx = self.stream_calls
        self.stream_calls += 1
        chunks = self.rounds[idx] if idx < len(self.rounds) else []

        async def _gen():
            for c in chunks:
                yield c

        return _gen()


class _FakeClient:
    def __init__(self, completions):
        self.chat = SimpleNamespace(completions=completions)


def _chunk(content=None, tool_calls=None, usage=None):
    """One streamed chunk in the OpenAI delta shape run_agent reads."""
    delta = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)], usage=usage)


def _fc_chunk(name="search_notes", args='{"query": "q"}', index=0, call_id="call_1"):
    tc = SimpleNamespace(index=index, id=call_id,
                         function=SimpleNamespace(name=name, arguments=args))
    return _chunk(tool_calls=[tc])


def _install_models(monkeypatch, rounds, final_text, dispatched=None):
    async def _fake_dispatch(name, args, ctx):
        if dispatched is not None:
            dispatched.append((name, args))
        return {"count": 0, "notes": []}

    monkeypatch.setattr(at, "dispatch", _fake_dispatch)
    monkeypatch.setattr(settings, "ASK_ENABLE_TOOLS", True)
    completions = _FakeCompletions(rounds, final_text)
    monkeypatch.setattr(at.gemini_service, "aclient", _FakeClient(completions))
    return completions


async def _collect(ctx):
    return [ev async for ev in at.run_agent(ctx)]


async def test_run_agent_retries_then_errors_when_still_empty(monkeypatch):
    # Round 0 calls a tool (no text); round 1 (last) returns nothing → retry runs → retry
    # ALSO empty → a single friendly error event, never a silent finish.
    models = _install_models(monkeypatch, rounds=[[_fc_chunk()], []], final_text="")
    events = await _collect(_ctx(max_rounds=2))

    assert models.gen_calls == 1, "the tool-free retry generate must run exactly once"
    assert not any(e["type"] == "delta" for e in events)
    errors = [e for e in events if e["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["message"] == at.NO_ANSWER_MESSAGE


async def test_run_agent_retry_recovers_with_text(monkeypatch):
    # Same empty-final-round path, but the retry produces text → one delta, no error.
    models = _install_models(monkeypatch, rounds=[[_fc_chunk()], []],
                             final_text="Here is your Turkey plan.")
    events = await _collect(_ctx(max_rounds=2))

    assert models.gen_calls == 1
    deltas = [e for e in events if e["type"] == "delta"]
    assert deltas and deltas[-1]["text"] == "Here is your Turkey plan."
    assert not any(e["type"] == "error" for e in events)


async def test_run_agent_normal_path_unchanged(monkeypatch):
    # Model answers with text on the first round → no retry, no error (contract intact).
    models = _install_models(monkeypatch, rounds=[[_chunk("Hello!")]],
                             final_text="SHOULD NOT BE USED")
    events = await _collect(_ctx(max_rounds=2))

    assert models.gen_calls == 0, "a normal answer must not trigger the retry generate"
    assert [e for e in events if e["type"] == "delta"] == [{"type": "delta", "text": "Hello!"}]
    assert not any(e["type"] == "error" for e in events)


async def test_run_agent_accumulates_streamed_tool_call_args_and_threads_messages(monkeypatch):
    # The tool call's name/id arrive in one delta and its JSON arguments split across two;
    # they must be joined by `index`, dispatched once, and threaded back as assistant
    # tool_calls + a role=tool message. The last round keeps `tools` with tool_choice="none".
    split = [
        _chunk(tool_calls=[SimpleNamespace(index=0, id="call_x", function=SimpleNamespace(
            name="search_notes", arguments='{"query": '))]),
        _chunk(tool_calls=[SimpleNamespace(index=0, id=None, function=SimpleNamespace(
            name=None, arguments='"pasta"}'))]),
        SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=5, completion_tokens=2)),
    ]
    dispatched: list = []
    comp = _install_models(monkeypatch, rounds=[split, [_chunk("Found it.")]],
                           final_text="unused", dispatched=dispatched)
    events = await _collect(_ctx(max_rounds=2))

    assert dispatched == [("search_notes", {"query": "pasta"})]
    assert [e for e in events if e["type"] == "delta"] == [{"type": "delta", "text": "Found it."}]
    second = comp.calls[1]
    assert second["tool_choice"] == "none" and second["tools"]  # tools kept on last round
    assistant, tool_msg = second["messages"][-2:]
    assert assistant["tool_calls"][0]["id"] == "call_x"
    assert assistant["tool_calls"][0]["function"]["arguments"] == '{"query": "pasta"}'
    assert tool_msg["role"] == "tool" and tool_msg["tool_call_id"] == "call_x"
    assert comp.calls[0]["stream"] is True
    assert comp.calls[0]["extra_body"] == {"reasoning": {"enabled": False}}


async def test_run_agent_bad_tool_args_dispatch_with_empty_dict(monkeypatch):
    dispatched: list = []
    _install_models(monkeypatch, rounds=[[_fc_chunk(args="{not json")], [_chunk("ok")]],
                    final_text="", dispatched=dispatched)
    await _collect(_ctx(max_rounds=2))
    assert dispatched == [("search_notes", {})]


# ── initial contents (date + dated, labelled preview) ────────────────────────
def test_initial_contents_injects_local_date_and_dated_preview():
    pool = [{"id": "n1", "content_type": "recipe", "title": "Soup",
             "ai_summary": "", "created_at": datetime(2026, 6, 16, tzinfo=timezone.utc)}]
    ctx = _ctx(pool=pool, now_utc=datetime(2026, 6, 16, 12, 0, tzinfo=timezone.utc))
    msgs = at._initial_contents(ctx)
    assert msgs[0] == {"role": "system", "content": at.ASK_ORCHESTRATOR_SYSTEM}
    text = msgs[1]["content"]
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
    assert "research_web" not in {d["function"]["name"] for d in at._tool_declarations()}
    monkeypatch.setattr(settings, "ENABLE_WEB_TOOLS", True)
    names = {d["function"]["name"] for d in at._tool_declarations()}
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
