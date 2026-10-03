"""Clipnote Agent — dynamic orchestrator + subagents + tools (Phase 1).

The orchestrator (`run_agent`) is a streaming OpenAI-style tool-calling loop (OpenRouter). Its "tools" are a
mix of cheap deterministic leaf tools (maps/directions/compute) and reasoning **subagents**
that wrap the existing services (notes RAG, artifact synthesis, note authoring). Web tools
(research_web / fetch_url) are declared but gated behind ENABLE_WEB_TOOLS.

Lives in a service (not the router) and keeps run_agent here — not in gemini.py — so imports
flow one way: agent_tools → {gemini_service, note_retrieval, net_guard}. The router wires it.

Streaming notes:
  - use the async client (`gemini_service.aclient`); the sync iterator can't yield
    incrementally from an async route.
  - final output is markdown (no JSON mode with tools); citations come from the note ids
    subagents actually returned (collected in ctx).
  - `usage` arrives on the final chunk only (with empty `choices`) → meter once per round.
  - parallel tool calls are model-dependent (not guaranteed like Gemini's batched calls).
"""
import ast
import asyncio
import json
import logging
import operator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from urllib.parse import quote_plus

from config import settings
from models.ask import ArtifactNote, AskPlan
from services import note_retrieval as nr
from services.firebase import get_user_categories
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
  queries/filters. Its filters:
    · period — for time-bound questions ("today", "yesterday", "this week/month"): pass the
      matching keyword (today|yesterday|this_week|last_week|this_month|recent). The date math is
      done server-side in the user's timezone — you do NOT filter by date yourself.
    · content_types — when the user names a type ("my recipes", "saved products").
    · source — when they name where it came from ("my Pinterest notes", "from YouTube").
    · exhaustive=true — for "all / every / how many / list everything" questions, so you get the
      complete set instead of a top-K sample.
- research_web: current/external facts NOT in their notes (prices, hours, papers, live rates).
  Never invent these — fetch them.
- fetch_url: read a specific web page's content.
- maps_link / directions_link: build a Google Maps link for a place / directions between two.
- compute: arithmetic only (totals, scaling, unit math). Pass a plain expression like "120*1.85".
- build_artifact: turn notes into ONE structured document (itinerary / meal_plan / comparison /
  checklist / document) the user can save. Pass the note_ids to use and an instruction.
- author_note: draft a brand-new note from the conversation.

Rules:
- The "sample of recent notes" you may be given up front is only a NON-EXHAUSTIVE preview to help
  you choose search_notes filters — it is NOT the answer set and is NOT filtered by date or type.
  Never answer a "what did I save…" question straight from it; call search_notes (with the right
  period/content_types/source/exhaustive) so the answer reflects the actual matching notes.
- Ground saved-fact claims in search_notes results; use research_web for anything external.
  Never fabricate links, prices, or citations.
- For "recommend X for this note" (e.g. hotels for a trip), FIRST search_notes to get the note's
  constraints (destination, dates, budget, cuisine…), THEN pass those into research_web.
- Prefer the smallest number of tool calls that fully answers. Don't call tools you don't need.
- When you build or author something, still give a short chat answer; the artifact is shown separately.
- Be specific and concise. Markdown only (no HTML). Links are allowed when they come from a tool."""


# ──────────────────────────── tool declarations ────────────────────────────

def _decl(name, description, properties, required=None):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties, "required": required or []},
    }}


_STR = {"type": "string"}
_BOOL = {"type": "boolean"}
_STRLIST = {"type": "array", "items": {"type": "string"}}


def _tool_declarations() -> list[dict]:
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
    synth = await gemini_service.synthesize(instruction, ctx.history, notes, out, focal_title,
                                            await get_user_categories(ctx.user_id))
    ctx.artifact = synth.artifact
    return {"built": True, "title": synth.artifact.title, "kind": out}


async def _sub_author_note(ctx: AgentContext, instruction: str) -> dict:
    full_history = ctx.history + [{"role": "user", "text": instruction}]
    artifact = await gemini_service.create_note(instruction, full_history,
                                                await get_user_categories(ctx.user_id))
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

def _initial_contents(ctx: AgentContext) -> list[dict]:
    parts = []
    # Tell the agent the user's local date so it can map "today"/"this week" to a period keyword.
    local_now = ctx.now_utc + timedelta(minutes=ctx.tz_offset_minutes)
    parts.append(f"The user's current local date is {local_now.strftime('%Y-%m-%d (%A)')}.")
    if ctx.memory_block:
        parts.append(f"Known about this user:\n{ctx.memory_block}")
    index = nr.dated_index(ctx.pool, ctx.tz_offset_minutes)
    if index:
        parts.append(
            "NON-EXHAUSTIVE preview of recent notes (id · saved-date · type · title) — for picking "
            "search_notes filters only, NOT the answer set; call search_notes to actually answer:\n"
            + "\n".join(
                f"- {n['id']} · {n['saved'] or '?'} · {n['type']} · {n['title']}"
                for n in index[:30]))
    if ctx.focal:
        parts.append(f'The user is currently viewing the note "{ctx.focal.get("title","")}" '
                     f'(id {ctx.focal.get("id")}). Treat it as the primary subject.')
    if ctx.selected_note_ids:
        parts.append("The user restricted this chat to specific notes; search_notes returns only those.")
    if ctx.history:
        parts.append("Conversation so far:\n" + "\n".join(
            f"{t['role']}: {t['text']}" for t in ctx.history))
    parts.append(f"User message: {ctx.question}")
    return [{"role": "system", "content": ASK_ORCHESTRATOR_SYSTEM},
            {"role": "user", "content": "\n\n".join(parts)}]


# Last-ditch nudge for a run that ended without ever emitting a token — most often a round
# whose only output was function calls, followed by a final round that returned nothing.
_RETRY_NUDGE = (
    "Use the tool results above to answer the user's question now. Reply in plain markdown. "
    "If the tool results don't contain the answer, say briefly and directly what you could not "
    "find — never reply with nothing.")

NO_ANSWER_MESSAGE = "I couldn't put together an answer just now. Please try again."


_NO_REASONING = {"reasoning": {"enabled": False}}


async def _retry_final_answer(ctx: AgentContext, messages: list) -> str:
    """One tool-free completion over the tool results already gathered in `messages`.
    Returns the answer text (may be empty on failure). Metered like any other model call."""
    kwargs = {}
    if any(m.get("role") == "tool" for m in messages):
        # Some providers reject tool messages in history unless `tools` is present.
        kwargs = {"tools": _tool_declarations(), "tool_choice": "none"}
    resp = await gemini_service.aclient.chat.completions.create(
        model=settings.TEXT_MODEL, messages=messages + [{"role": "user", "content": _RETRY_NUDGE}],
        temperature=0.3, extra_body=_NO_REASONING, **kwargs)
    record_usage(settings.TEXT_MODEL, resp)
    text = resp.choices[0].message.content if resp.choices else None
    return (text or "").strip()


def _tool_label(name: str) -> str:
    return "Searching your notes…" if name == "search_notes" else (
        "Building it…" if name in ("build_artifact", "author_note") else (
            "Checking the web…" if name in _WEB_TOOLS else f"{name}…"))


def _parse_args(raw: str) -> dict:
    try:
        args = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    return args if isinstance(args, dict) else {}


async def run_agent(ctx: AgentContext):
    """Stream the agent. Yields event dicts: {type: delta|tool|agent|error, ...}.
    Citations/artifact are read off `ctx` by the caller after the generator finishes."""
    messages = _initial_contents(ctx)
    use_tools = settings.ASK_ENABLE_TOOLS
    tools = _tool_declarations() if use_tools else None

    any_delta = False  # did the whole run ever emit visible text?

    for round_i in range(ctx.max_rounds):
        # Force a final, tool-free answer on the last allowed round. `tools` stays present
        # (tool_choice="none") because some providers reject tool messages in history otherwise.
        last_round = round_i == ctx.max_rounds - 1
        kwargs: dict = {}
        if tools:
            kwargs["tools"] = tools
            if last_round:
                kwargs["tool_choice"] = "none"

        calls: dict[int, dict] = {}  # stream index -> {id, name, arguments}
        last_usage_chunk = None
        try:
            stream = await gemini_service.aclient.chat.completions.create(
                model=settings.TEXT_MODEL, messages=messages, temperature=0.3, stream=True,
                stream_options={"include_usage": True}, extra_body=_NO_REASONING, **kwargs)
            async for chunk in stream:
                if getattr(chunk, "usage", None) is not None:
                    last_usage_chunk = chunk
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if getattr(delta, "content", None):
                    any_delta = True
                    yield {"type": "delta", "text": delta.content}
                for tc in (getattr(delta, "tool_calls", None) or []):
                    slot = calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    fn = getattr(tc, "function", None)
                    if fn is not None:
                        if fn.name:
                            slot["name"] = fn.name
                        if fn.arguments:
                            slot["arguments"] += fn.arguments
        except Exception as e:
            log.error("agent stream failed: %s: %s", type(e).__name__, e,
                      extra={"user_id": ctx.user_id})
            if last_usage_chunk is not None:  # bill whatever streamed before the failure
                record_usage(settings.TEXT_MODEL, last_usage_chunk)
            yield {"type": "error", "message": "The assistant had trouble answering."}
            return
        if last_usage_chunk is not None:
            record_usage(settings.TEXT_MODEL, last_usage_chunk)

        tool_calls = [calls[i] for i in sorted(calls) if calls[i]["name"]]
        if not tool_calls:
            break  # the model answered (or produced nothing) — finalize below

        for n, c in enumerate(tool_calls):
            c["id"] = c["id"] or f"call_{round_i}_{n}"
        messages.append({"role": "assistant", "content": None, "tool_calls": [
            {"id": c["id"], "type": "function",
             "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
            for c in tool_calls]})
        # Emit status events first so the UI shows all tools starting immediately.
        for c in tool_calls:
            yield {"type": ("agent" if c["name"] in _SUBAGENTS else "tool"),
                   "name": c["name"], "status": _tool_label(c["name"])}
        # Execute all tool calls concurrently — calls batched in one turn have no data
        # dependency between them.
        results = await asyncio.gather(*(
            dispatch(c["name"], _parse_args(c["arguments"]), ctx) for c in tool_calls))
        for c, result in zip(tool_calls, results):
            messages.append({"role": "tool", "tool_call_id": c["id"],
                             "content": json.dumps(result, ensure_ascii=False, default=str)})

    # The run ended (model stopped calling tools, or rounds exhausted) without ever streaming
    # a token and without building an artifact — the silent-empty-answer bug. Make ONE tool-free
    # retry over the tool results already gathered; if that's still empty, surface a clear error
    # instead of leaving the user with nothing.
    if not any_delta and ctx.artifact is None:
        text = ""
        try:
            text = await _retry_final_answer(ctx, messages)
        except Exception as e:
            log.error("agent retry answer failed: %s: %s", type(e).__name__, e,
                      extra={"user_id": ctx.user_id})
        if text:
            yield {"type": "delta", "text": text}
        else:
            log.error("agent produced no answer after retry",
                      extra={"user_id": ctx.user_id})
            yield {"type": "error", "message": NO_ANSWER_MESSAGE}


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
