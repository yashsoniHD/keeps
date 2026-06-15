"""Clipnote Agent: leaf tools, dispatch budgets/gating, SSRF, and additive note merge."""
from datetime import datetime, timezone

import pytest

import services.agent_tools as at
from config import settings
from routers.notes import _merge_blocks


def _ctx(**kw):
    base = dict(db=None, user_id="u", question="q", history=[], pool=[],
                tz_offset_minutes=0, now_utc=datetime.now(timezone.utc))
    base.update(kw)
    return at.AgentContext(**base)


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
