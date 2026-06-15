"""Clipnote Agent — dynamic orchestrator + subagents + tools (Phase 1).

The orchestrator (`run_agent`) is a streaming Gemini function-calling loop. Its "tools" are a
mix of cheap deterministic leaf tools (maps/directions/compute) and reasoning **subagents**
that wrap the existing services (notes RAG, artifact synthesis, note authoring). Web tools
(research_web / fetch_url) are declared but gated behind ENABLE_WEB_TOOLS.

Lives in a service (not the router) and keeps run_agent here — not in gemini.py — so imports
flow one way: agent_tools → {gemini_service, note_retrieval, net_guard}. The router wires it.

Streaming notes (verified against docs):
  - use the SDK's native async client (`client.aio.…generate_content_stream`); the sync
    iterator can't yield incrementally from an async route.
  - function calling is incompatible with response_mime_type=json → final output is markdown;
    citations come from the note ids subagents actually returned (collected in ctx).
  - usage_metadata is on the final chunk only → meter once per turn from the last chunk.
"""
import ast
import asyncio
import json
import logging
import operator
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import quote_plus

from google.genai import types

from config import settings
from models.ask import ArtifactNote, AskPlan
from services import note_retrieval as nr
from services.gemini import gemini_service
from services.net_guard import BlockedURLError, assert_public_url_async, guarded_async_client
from services.usage_meter import record_usage

log = logging.getLogger("clipnote.agent")

MAPS_SEARCH = "https://www.google.com/maps/search/?api=1&query={}"
MAPS_DIRECTIONS = "https://www.google.com/maps/dir/?api=1&origin={}&destination={}"


# ──────────────────────────── orchestrator system prompt ────────────────────────────

ASK_ORCHESTRATOR_SYSTEM = """You are Clipnote's agent. The user saves links as structured notes;
you help them act on those notes. You have tools — use them, then answer in clear markdown.

Tools:
- search_notes: the user's saved notes. Your ONLY source of their saved facts. Call it first
  whenever the question is about what they saved. You may call it more than once with different
  queries/filters.
- research_web: current/external facts NOT in their notes (prices, hours, papers, live rates).
  Never invent these — fetch them.
- fetch_url: read a specific web page's content.
- maps_link / directions_link: build a Google Maps link for a place / directions between two.
- compute: arithmetic only (totals, scaling, unit math). Pass a plain expression like "120*1.85".
- build_artifact: turn notes into ONE structured document (itinerary / meal_plan / comparison /
  checklist / document) the user can save. Pass the note_ids to use and an instruction.
- author_note: draft a brand-new note from the conversation.

Rules:
- Ground saved-fact claims in search_notes results; use research_web for anything external.
  Never fabricate links, prices, or citations.
- For "recommend X for this note" (e.g. hotels for a trip), FIRST search_notes to get the note's
  constraints (destination, dates, budget, cuisine…), THEN pass those into research_web.
- Prefer the smallest number of tool calls that fully answers. Don't call tools you don't need.
- When you build or author something, still give a short chat answer; the artifact is shown separately.
- Be specific and concise. Markdown only (no HTML). Links are allowed when they come from a tool."""


# ──────────────────────────── tool declarations ────────────────────────────

def _decl(name, description, properties, required=None):
    return types.FunctionDeclaration(
        name=name, description=description,
        parameters=types.Schema(
            type=types.Type.OBJECT,
            properties={k: types.Schema(**v) for k, v in properties.items()},
            required=required or [],
        ),
    )


_STR = {"type": types.Type.STRING}
_BOOL = {"type": types.Type.BOOLEAN}
_STRLIST = {"type": types.Type.ARRAY, "items": types.Schema(type=types.Type.STRING)}


def _tool_declarations() -> list[types.FunctionDeclaration]:
    decls = [
        _decl("search_notes", "Search the user's saved notes. Returns matching notes with ids.",
              {"query": {**_STR, "description": "what to look for in their notes"},
               "content_types": {**_STRLIST, "description": "optional type slugs e.g. recipe, place"},
               "period": {**_STR, "description": "optional: today|yesterday|this_week|last_week|this_month|recent"},
               "source": {**_STR, "description": "optional source brand e.g. pinterest, youtube"},
               "exhaustive": {**_BOOL, "description": "true to fetch the full filtered set, not a top-K"}},
              required=["query"]),
        _decl("maps_link", "Build a Google Maps search link for a place.",
              {"place": {**_STR, "description": "place name"},
               "locality": {**_STR, "description": "optional city/area to disambiguate"}},
              required=["place"]),
        _decl("directions_link", "Build a Google Maps directions link between two places.",
              {"origin": _STR, "destination": _STR}, required=["origin", "destination"]),
        _decl("compute", "Evaluate a plain arithmetic expression (totals, scaling, conversions).",
              {"expression": {**_STR, "description": 'e.g. "120*1.85+30"'}}, required=["expression"]),
        _decl("build_artifact",
              "Consolidate notes into one structured document the user can save.",
              {"note_ids": {**_STRLIST, "description": "ids of notes to use (from search_notes)"},
               "output": {**_STR, "description": "itinerary|meal_plan|comparison|checklist|document"},
               "instruction": {**_STR, "description": "what to build"}},
              required=["note_ids", "output", "instruction"]),
        _decl("author_note", "Draft a brand-new note from the conversation.",
              {"instruction": {**_STR, "description": "what the note should capture"}},
              required=["instruction"]),
    ]
    if settings.ENABLE_WEB_TOOLS:
        decls += [
            _decl("research_web", "Look up current/external facts via web search. Returns sourced text.",
                  {"query": {**_STR, "description": "what to find on the web"}}, required=["query"]),
            _decl("fetch_url", "Fetch and read the content of a specific URL.",
                  {"url": _STR}, required=["url"]),
        ]
    return decls


# ──────────────────────────── agent context ────────────────────────────

@dataclass
class AgentContext:
    db: object
    user_id: str
    question: str
    history: list[dict]
    pool: list[dict]                       # candidate notes (recent ∪ vector) for the opening question
    tz_offset_minutes: int
    now_utc: datetime
    focal: dict | None = None
    selected_note_ids: list[str] = field(default_factory=list)
    memory_block: str = ""                 # "Known about this user" (Phase 5); empty for now
    # Budgets — interactive defaults; deep async tasks raise these for heavier jobs.
    max_grounded: int = settings.ASK_MAX_GROUNDED_NOTES
    max_rounds: int = settings.MAX_ORCH_ROUNDS
    # accumulators read by the router after the run
    notes_by_id: dict = field(default_factory=dict)   # id -> full note (for citations)
    cited_ids: list[str] = field(default_factory=list)
    artifact: ArtifactNote | None = None
    # budgets
    tool_calls: int = 0
    subagent_calls: int = 0


# ──────────────────────────── leaf tools ────────────────────────────

def maps_link(place: str, locality: str = "") -> dict:
    q = " ".join(p for p in (place, locality) if p).strip()
    if not q:
        return {"error": "place is required"}
    return {"url": MAPS_SEARCH.format(quote_plus(q)), "place": q}


def directions_link(origin: str, destination: str) -> dict:
    if not origin or not destination:
        return {"error": "origin and destination are required"}
    return {"url": MAPS_DIRECTIONS.format(quote_plus(origin), quote_plus(destination))}


_COMPUTE_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.USub: operator.neg, ast.UAdd: operator.pos, ast.FloorDiv: operator.floordiv,
}


def _safe_eval(node):
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError("only numbers allowed")
    if isinstance(node, ast.BinOp) and type(node.op) in _COMPUTE_OPS:
        return _COMPUTE_OPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _COMPUTE_OPS:
        return _COMPUTE_OPS[type(node.op)](_safe_eval(node.operand))
    raise ValueError("unsupported expression")


def compute(expression: str) -> dict:
    """Arithmetic only — an AST evaluator, never `eval`. Rejects names, calls, attributes."""
    try:
        tree = ast.parse(expression, mode="eval")
        result = _safe_eval(tree.body)
    except Exception:
        return {"error": "could not evaluate; pass a plain arithmetic expression"}
    return {"result": result, "expression": expression}


async def fetch_url(url: str) -> dict:
    """SSRF-guarded fetch of a user/agent-supplied URL. Returns trimmed text."""
    try:
        await assert_public_url_async(url)
    except BlockedURLError as e:
        return {"error": f"blocked URL: {e}"}
    except Exception:
        return {"error": "invalid URL"}
    try:
        async with guarded_async_client(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; Clipnote)"})
        text = resp.text
    except BlockedURLError as e:
        return {"error": f"blocked redirect: {e}"}
    except Exception as e:
        return {"error": f"fetch failed: {type(e).__name__}"}
    return {"url": url, "content": text[: settings.TOOL_RESULT_MAX_CHARS]}


# ──────────────────────────── subagents ────────────────────────────

def _note_summary(n: dict) -> dict:
    return {
        "id": n.get("id"),
        "type": n.get("content_type", ""),
        "title": n.get("title", ""),
        "summary": (n.get("ai_summary") or "")[:200],
        "data": json.loads(json.dumps(n.get("data", {}), default=str))
        if n.get("data") else {},
    }


async def _sub_search_notes(ctx: AgentContext, query: str, content_types=None,
                            period: str = "", source: str = "", exhaustive: bool = False) -> dict:
    """Notes-RAG subagent. Honors an explicit selection; else builds retrieval from the args,
    reusing the same deterministic paths as the legacy planner."""
    if ctx.selected_note_ids:
        notes = await nr.fetch_notes_by_ids(ctx.db, ctx.user_id, ctx.selected_note_ids)
    else:
        plan = AskPlan(
            content_types=content_types or [], period=period or None,
            source=source or None, exhaustive=bool(exhaustive),
        )
        if plan.content_types or plan.period or plan.source:
            notes, _ = await nr.retrieve_notes(ctx.db, ctx.user_id, plan, ctx.pool,
                                               ctx.tz_offset_minutes, ctx.now_utc)
        else:
            # Pure semantic: rank by vector similarity to THIS query, then hydrate.
            shortlist = await nr.vector_shortlist(ctx.db, ctx.user_id, query)
            ids = [n["id"] for n in (shortlist or ctx.pool)][: ctx.max_grounded]
            notes = await nr.fetch_notes_by_ids(ctx.db, ctx.user_id, ids)

    # Lead with the focal note if the chat was opened from one.
    if ctx.focal:
        notes = [ctx.focal] + [n for n in notes if n.get("id") != ctx.focal.get("id")]
    notes = notes[: ctx.max_grounded]
    for n in notes:
        if n.get("id"):
            ctx.notes_by_id[n["id"]] = n
            if n["id"] not in ctx.cited_ids:
                ctx.cited_ids.append(n["id"])
    return {"count": len(notes), "notes": [_note_summary(n) for n in notes]}


async def _sub_build_artifact(ctx: AgentContext, note_ids: list[str], output: str,
                              instruction: str) -> dict:
    notes = [ctx.notes_by_id[i] for i in note_ids if i in ctx.notes_by_id]
    if not notes:  # ids the model invented or didn't search first — fetch defensively
        notes = await nr.fetch_notes_by_ids(ctx.db, ctx.user_id, note_ids)
    if not notes:
        return {"error": "no matching notes; call search_notes first"}
    valid = {"itinerary", "meal_plan", "comparison", "checklist", "document"}
    out = output if output in valid else "document"
    focal_title = ctx.focal.get("title") if ctx.focal else None
    synth = await gemini_service.synthesize(instruction, ctx.history, notes, out, focal_title)
    ctx.artifact = synth.artifact
    return {"built": True, "title": synth.artifact.title, "kind": out}


async def _sub_author_note(ctx: AgentContext, instruction: str) -> dict:
    full_history = ctx.history + [{"role": "user", "text": instruction}]
    artifact = await gemini_service.create_note(instruction, full_history)
    ctx.artifact = artifact
    return {"built": True, "title": artifact.title}


async def _sub_research_web(ctx: AgentContext, query: str) -> dict:
    text = await gemini_service.web_research(query)
    if not text:
        return {"result": "no useful results found"}
    return {"result": text[: settings.TOOL_RESULT_MAX_CHARS]}


# ──────────────────────────── dispatch ────────────────────────────

_SUBAGENTS = {"search_notes", "build_artifact", "author_note", "research_web"}
_WEB_TOOLS = {"research_web", "fetch_url"}


async def dispatch(name: str, args: dict, ctx: AgentContext) -> dict:
    """Execute one tool/subagent call. Enforces per-ask budgets and degrades (returns
    {"error": …}) instead of raising, so a bad call never 500s the stream."""
    ctx.tool_calls += 1
    if ctx.tool_calls > settings.MAX_TOOL_CALLS_PER_ASK:
        return {"error": "tool budget exhausted — answer with what you have"}
    if name in _SUBAGENTS:
        ctx.subagent_calls += 1
        if ctx.subagent_calls > settings.MAX_SUBAGENT_CALLS_PER_ASK:
            return {"error": "subagent budget exhausted — answer with what you have"}
    if name in _WEB_TOOLS and not settings.ENABLE_WEB_TOOLS:
        return {"error": "web tools are disabled"}

    args = args or {}
    try:
        if name == "search_notes":
            return await _sub_search_notes(ctx, **args)
        if name == "maps_link":
            return maps_link(args.get("place", ""), args.get("locality", ""))
        if name == "directions_link":
            return directions_link(args.get("origin", ""), args.get("destination", ""))
        if name == "compute":
            return compute(args.get("expression", ""))
        if name == "build_artifact":
            return await _sub_build_artifact(ctx, args.get("note_ids", []),
                                             args.get("output", "document"),
                                             args.get("instruction", ctx.question))
        if name == "author_note":
            return await _sub_author_note(ctx, args.get("instruction", ctx.question))
        if name == "research_web":
            return await _sub_research_web(ctx, args.get("query", ""))
        if name == "fetch_url":
            return await fetch_url(args.get("url", ""))
    except Exception as e:
        log.warning("tool %s failed: %s: %s", name, type(e).__name__, e,
                    extra={"user_id": ctx.user_id})
        return {"error": f"{name} failed"}
    return {"error": f"unknown tool {name}"}


# ──────────────────────────── orchestrator ────────────────────────────

def _initial_contents(ctx: AgentContext) -> list[types.Content]:
    parts = []
    if ctx.memory_block:
        parts.append(f"Known about this user:\n{ctx.memory_block}")
    index = nr.dated_index(ctx.pool, ctx.tz_offset_minutes)
    if index:
        parts.append("A sample of the user's recent notes (id · type · title):\n" + "\n".join(
            f"- {n['id']} · {n['type']} · {n['title']}" for n in index[:30]))
    if ctx.focal:
        parts.append(f'The user is currently viewing the note "{ctx.focal.get("title","")}" '
                     f'(id {ctx.focal.get("id")}). Treat it as the primary subject.')
    if ctx.selected_note_ids:
        parts.append("The user restricted this chat to specific notes; search_notes returns only those.")
    if ctx.history:
        parts.append("Conversation so far:\n" + "\n".join(
            f"{t['role']}: {t['text']}" for t in ctx.history))
    parts.append(f"User message: {ctx.question}")
    return [types.Content(role="user", parts=[types.Part(text="\n\n".join(parts))])]


def _function_calls(chunk) -> list:
    calls = []
    for cand in (getattr(chunk, "candidates", None) or []):
        content = getattr(cand, "content", None)
        for part in (getattr(content, "parts", None) or []):
            fc = getattr(part, "function_call", None)
            if fc is not None:
                calls.append(fc)
    return calls


async def run_agent(ctx: AgentContext):
    """Stream the agent. Yields event dicts: {type: delta|tool|agent|error, ...}.
    Citations/artifact are read off `ctx` by the caller after the generator finishes."""
    contents = _initial_contents(ctx)
    use_tools = settings.ASK_ENABLE_TOOLS
    tool_config = types.GenerateContentConfig(
        system_instruction=ASK_ORCHESTRATOR_SYSTEM,
        tools=[types.Tool(function_declarations=_tool_declarations())] if use_tools else None,
        temperature=0.3,
    )

    for round_i in range(ctx.max_rounds):
        # Force a final, tool-free answer on the last allowed round.
        last_round = round_i == ctx.max_rounds - 1
        config = tool_config if (use_tools and not last_round) else types.GenerateContentConfig(
            system_instruction=ASK_ORCHESTRATOR_SYSTEM, temperature=0.3)

        calls: list = []
        last_chunk = None
        try:
            stream = await gemini_service.client.aio.models.generate_content_stream(
                model=settings.GEMINI_MODEL, contents=contents, config=config)
            async for chunk in stream:
                last_chunk = chunk
                text = getattr(chunk, "text", None)
                if text:
                    yield {"type": "delta", "text": text}
                calls.extend(_function_calls(chunk))
        except Exception as e:
            log.error("agent stream failed: %s: %s", type(e).__name__, e,
                      extra={"user_id": ctx.user_id})
            yield {"type": "error", "message": "The assistant had trouble answering."}
            return
        if last_chunk is not None:
            record_usage(settings.GEMINI_MODEL, last_chunk)

        if not calls:
            return  # the model answered

        # Re-attach the model's function-call turn, then run the tools and append responses.
        contents.append(types.Content(role="model",
                                      parts=[types.Part(function_call=fc) for fc in calls]))
        response_parts = []
        for fc in calls:
            args = dict(fc.args) if fc.args else {}
            label = "Searching your notes…" if fc.name == "search_notes" else (
                "Building it…" if fc.name in ("build_artifact", "author_note") else (
                    "Checking the web…" if fc.name in _WEB_TOOLS else f"{fc.name}…"))
            yield {"type": ("agent" if fc.name in _SUBAGENTS else "tool"),
                   "name": fc.name, "status": label}
            result = await dispatch(fc.name, args, ctx)
            response_parts.append(types.Part.from_function_response(name=fc.name, response=result))
        contents.append(types.Content(role="user", parts=response_parts))


async def run_agent_collect(ctx: AgentContext) -> dict:
    """Drive the agent to completion with no streaming consumer (deep async tasks).
    Returns the accumulated answer text plus whatever the run left on ctx (artifact, cited
    note ids). Raises only on a hard model failure surfaced as an `error` event."""
    text_parts: list[str] = []
    error: str | None = None
    async for ev in run_agent(ctx):
        if ev.get("type") == "delta":
            text_parts.append(str(ev.get("text", "")))
        elif ev.get("type") == "error":
            error = str(ev.get("message", "agent failed"))
    return {"text": "".join(text_parts).strip(), "artifact": ctx.artifact,
            "cited_ids": ctx.cited_ids, "error": error}
