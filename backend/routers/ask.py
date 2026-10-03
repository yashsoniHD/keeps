"""POST /api/ask — chat over the user's saved notes (and general questions).

Two-stage pattern: a lite-model PLANNER turns the message into a structured filter set
(AskPlan), then the main model answers. Retrieval is built from the plan:
  - scope=general          → no retrieval, a plain conversational answer (no citations)
  - period set             → a date-bounded Firestore query (the user's local day, via tz)
  - exhaustive / aggregate → the full filtered set by type (not a top-K shortlist)
  - otherwise              → the planner's semantic picks from a recent ∪ vector candidate pool
Stateless: the client sends the conversation history with each request.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from google.cloud import firestore as fs

import re

from config import settings
from models.ask import AskRequest, AskResponse, Citation
from models.note import JobStatus
from services.agent_tools import AgentContext, run_agent
from services.auth_dep import require_user
from services.dispatch import enqueue_process_job
from services.conversations import persist_exchange
from services.firebase import flush_usage, get_db, get_user_categories, touch_user_activity
from services.gemini import gemini_service
from services.net_guard import BlockedURLError, assert_public_url_async
from routers.ingest import _enforce_cost_caps, _run_inline
from services import note_retrieval as nr
# Retrieval lives in services.note_retrieval (shared with the agent). The endpoint calls it
# through the `nr` module so a test patching `nr.<fn>` affects both the endpoint and the
# internal calls inside `retrieve_notes`. These aliases stay for tests that reference the
# helpers directly (test_ask_planner) and for `_period_label` used below.
from services.note_retrieval import (  # noqa: F401
    fetch_notes_by_source as _fetch_notes_by_source,
    fetch_notes_by_types as _fetch_notes_by_types,
    fetch_notes_by_window as _fetch_notes_by_window,
    filter_types as _filter_types,
    period_bounds as _period_bounds,
    period_label as _period_label,
    recent_notes as _recent_notes,
    type_variants as _type_variants,
    vector_shortlist as _vector_shortlist,
    dated_index as _dated_index,
    candidate_pool as _candidate_pool,
    fetch_notes_by_ids as _fetch_notes_by_ids,
    retrieve_notes as _retrieve_notes,
)
from services.usage_meter import start_metering

log = logging.getLogger("clipnote.ask")

router = APIRouter(tags=["ask"])

NO_NOTES_ANSWER = (
    "You haven't saved any notes yet — clip a few links first, then ask me about them."
)
NOTHING_FOUND_ANSWER = "I couldn't find anything in your notes about that."

_URL_RE = re.compile(r'https?://\S+')

# ──────────────────────────── save-link helper ────────────────────────────

async def _save_link_from_chat(db, user_id: str, save_url: str,
                               save_hint: str | None) -> dict:
    """Validate, enqueue, and poll a save_link job initiated from Clip AI chat.

    Returns {"note_id": str, "title": str} on success, or raises HTTPException.
    Polls Firestore every 1.5 s for up to 45 s — enough for the worker
    to complete even on first-attempt transient retries.
    """
    if not save_url.startswith(("http://", "https://")):
        raise HTTPException(400, "That doesn't look like a valid URL.")
    try:
        await assert_public_url_async(save_url)
    except BlockedURLError:
        raise HTTPException(400, "That URL points at a private address and can't be saved.")

    await _enforce_cost_caps(db, user_id)

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.collection("jobs").document(job_id).set({
        "user_id": user_id,
        "url": save_url,
        "content": None,
        "source": "ai_chat",
        "note_hint": save_hint,
        "status": "pending",
        "note_id": None,
        "error": None,
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    })
    await _dispatch_job(db, job_id)

    # Poll until completed/failed, or timeout.
    for _ in range(30):
        await asyncio.sleep(1.5)
        snap = await db.collection("jobs").document(job_id).get()
        job = snap.to_dict() or {}
        status = job.get("status")
        if status == "completed":
            note_id = job.get("note_id", "")
            if note_id:
                note_snap = await db.collection("notes").document(note_id).get()
                title = (note_snap.to_dict() or {}).get("title", "Untitled")
                return {"note_id": note_id, "title": title}
        elif status == "failed":
            raise HTTPException(502, "Couldn't process that link — please try saving it from the main feed.")

    # Timed out — note is still processing (rare; happens on cold-start + slow source).
    return {"note_id": None, "title": None}


async def _enforce_ask_caps(db, user_id: str) -> None:
    """Transactional per-user + global daily counter on ask_count. Raises 429 at a limit."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    transaction = db.transaction()

    @fs.async_transactional
    async def _bump(tx):
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("ask_count", 0)
        global_n = (global_snap.to_dict() or {}).get("ask_count", 0)
        if user_n >= settings.MAX_ASKS_PER_USER_PER_DAY:
            raise HTTPException(429, "Daily Ask AI limit reached. Try again tomorrow.")
        if global_n >= settings.DAILY_GLOBAL_ASK_CAP:
            raise HTTPException(429, "Ask AI is at capacity today. Try again tomorrow.")
        tx.set(user_ref, {"user_id": user_id, "date": today, "ask_count": user_n + 1}, merge=True)
        tx.set(global_ref, {"date": today, "ask_count": global_n + 1}, merge=True)

    await _bump(transaction)


async def _general_answer(question: str, history: list[dict]) -> str:
    """A plain conversational answer (no notes, no citations). Degrades to a friendly
    message instead of a 500 if the model stage fails."""
    try:
        return (await gemini_service.answer_chat(question, history)).answer_markdown
    except Exception as e:
        log.error("ask chat stage failed: %s: %s", type(e).__name__, e)
        return "Sorry — I couldn't put together an answer just now. Please try again."


async def _dispatch_job(db, job_id: str, path: str = "/api/process") -> bool:
    """Kick the worker like ingest does: inline in dev (no WORKER_SECRET), else dispatch off-loop.
    A dispatch failure marks the job failed instead of 500ing. Returns False on failure."""
    if not settings.WORKER_SECRET and path == "/api/process":
        # ponytail: the deep-agent worker has no inline entry point, so dev agent jobs fail fast
        # below instead of running; add one in process.py if local deep-agent runs are needed.
        asyncio.create_task(_run_inline(job_id))
        return True
    try:
        await asyncio.to_thread(enqueue_process_job, job_id, path)
        return True
    except Exception as e:  # noqa: BLE001 — any enqueue failure is terminal for this job
        log.error("enqueue failed, marking job failed: %s: %s", type(e).__name__, e,
                  extra={"job_id": job_id})
        await db.collection("jobs").document(job_id).update({
            "status": "failed", "error": "dispatch_failed",
            "updated_at": datetime.now(timezone.utc)})
        return False


@router.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest, user_id: str = Depends(require_user)):
    db = get_db()
    history = [t.model_dump() for t in body.history[-10:]]
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(minutes=body.tz_offset_minutes)
    today_str = local_now.strftime("%Y-%m-%d (%A)")

    # Caps first, then the meter, then any paid work: the candidate pool embeds the query,
    # so a capped user must 429 before it runs and its spend must land on the meter.
    await _enforce_ask_caps(db, user_id)
    await touch_user_activity(user_id)  # retention signal (best-effort)
    meter = start_metering()  # embeds + both Gemini stages; flushed once when the request ends
    try:
        pool = await nr.candidate_pool(db, user_id, body.question)
        index = nr.dated_index(pool, body.tz_offset_minutes)
        plan = await gemini_service.plan_ask(body.question, history[-4:], today_str, index)

        # Focal note: chat opened from a note's page. Fetch it (ownership-checked) so it can
        # be forced into the grounding set and ranked first. A stale/foreign id is ignored.
        focal: dict | None = None
        if body.note_id:
            found = await nr.fetch_notes_by_ids(db, user_id, [body.note_id])
            focal = found[0] if found else None

        # Create-a-note: author a draft from the whole conversation (a wider window than the
        # answer stages get) and return it as a savable artifact — no retrieval needed.
        if plan.intent == "create":
            full_history = [t.model_dump() for t in body.history]
            artifact = await gemini_service.create_note(
                body.question, full_history, await get_user_categories(user_id)
            )
            return AskResponse(answer="Here's a draft — save it if it looks right:",
                               artifact=artifact)

        # Save a link: validate, enqueue the ingest pipeline, poll for completion.
        if plan.intent == "save_link" and plan.save_url:
            result = await _save_link_from_chat(db, user_id, plan.save_url, plan.save_hint)
            if result["note_id"]:
                return AskResponse(
                    answer=f'Saved **{result["title"]}**! It\'s now in your notes.',
                    saved_note_id=result["note_id"],
                )
            return AskResponse(answer="Your note is being processed — it'll appear in your feed shortly.")

        # Opening Ask from inside a note means it's note-grounded even for terse prompts
        # ("summarize this"), so a focal note overrides a "general" plan.
        if focal:
            plan.scope = "notes"

        # General conversation / general-knowledge → answer plainly, no notes, no citations.
        if plan.scope == "general":
            return AskResponse(answer=await _general_answer(body.question, history))

        notes, matched_total = await nr.retrieve_notes(
            db, user_id, plan, pool, body.tz_offset_minutes, now_utc
        )
        # "This note first, then all": prepend the focal note (deduped) ahead of the
        # planner's matches so the answer leads with what the user is looking at.
        if focal:
            already = any(n["id"] == focal["id"] for n in notes)
            notes = [focal] + [n for n in notes if n["id"] != focal["id"]]
            if not already:
                matched_total += 1
        if not notes:
            # Specific, scoped misses get a specific message; an open-ended miss (no
            # time/source/type filter) falls back to a plain answer rather than a dead end —
            # this catches general questions the planner mis-tagged as note-scoped.
            if plan.period:
                return AskResponse(answer=f"You didn't save anything {_period_label(plan.period)}.")
            if plan.source:
                return AskResponse(answer=f"I couldn't find any notes from {plan.source}.")
            if plan.content_types:
                return AskResponse(answer=NOTHING_FOUND_ANSWER)
            if not pool:
                return AskResponse(answer=NO_NOTES_ANSWER)
            return AskResponse(answer=await _general_answer(body.question, history))

        coverage = (
            f"Based on {len(notes)} of {matched_total} matching notes."
            if matched_total > len(notes) else None
        )
        by_id = {n["id"]: n for n in notes}

        # Consolidation: build a structured artifact (itinerary/meal plan/comparison/checklist)
        # the UI renders and can save as a note. Otherwise, a normal grounded prose answer.
        focal_title = focal.get("title") if focal else None
        try:
            if plan.output != "prose":
                synth = await gemini_service.synthesize(
                    body.question, history, notes, plan.output, focal_title,
                    await get_user_categories(user_id)
                )
                answer_md, cited_ids, artifact = (
                    synth.answer_markdown, synth.cited_note_ids, synth.artifact
                )
            else:
                grounded = await gemini_service.answer_from_notes(body.question, history, notes,
                                                                  focal_title)
                answer_md, cited_ids, artifact = (
                    grounded.answer_markdown, grounded.cited_note_ids, None
                )
        except HTTPException:
            raise
        except Exception as e:
            log.error("ask answer stage failed: %s: %s", type(e).__name__, e,
                      extra={"user_id": user_id})
            raise HTTPException(502, "The assistant had trouble answering. Please try again.")

        citations = [
            Citation(
                id=cid,
                title=by_id[cid].get("title", ""),
                content_type=by_id[cid].get("content_type", ""),
                cover_image_url=by_id[cid].get("cover_image_url"),
                source_domain=by_id[cid].get("source_domain", ""),
                ref_id=cid,
            )
            for cid in dict.fromkeys(cited_ids)
            if cid in by_id
        ]
        return AskResponse(answer=answer_md, citations=citations,
                           coverage=coverage, artifact=artifact)
    finally:
        await flush_usage(user_id, meter)


# ──────────────────────────── streaming agent endpoint ────────────────────────────

def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"


def _citations_from_ctx(ctx: AgentContext) -> list[Citation]:
    return [
        Citation(
            id=cid,
            title=ctx.notes_by_id[cid].get("title", ""),
            content_type=ctx.notes_by_id[cid].get("content_type", ""),
            cover_image_url=ctx.notes_by_id[cid].get("cover_image_url"),
            source_domain=ctx.notes_by_id[cid].get("source_domain", ""),
            ref_id=cid,
        )
        for cid in ctx.cited_ids if cid in ctx.notes_by_id
    ]


@router.post("/ask/stream")
async def ask_stream(body: AskRequest, user_id: str = Depends(require_user)):
    """Dynamic agent over SSE: streams answer tokens + tool/agent status, then citations and
    any savable artifact. Caps are enforced before the stream opens (so 429s are clean JSON);
    the agent's many internal model calls are metered together and flushed once at the end."""
    db = get_db()
    history = [t.model_dump() for t in body.history[-10:]]
    now_utc = datetime.now(timezone.utc)

    # Enforce caps before opening the stream (a limit returns a normal 429, not mid-SSE) and
    # before the candidate pool — building it embeds the query, a paid call a capped user
    # must not trigger. The meter starts here too so that embed spend is attributed; the
    # contextvar it sets is inherited by the streaming task, which flushes it once at the end.
    await _enforce_ask_caps(db, user_id)
    await touch_user_activity(user_id)  # retention signal (best-effort)
    meter = start_metering()

    # Build the grounding pool. Explicit selection bypasses retrieval — the pool IS the chosen set.
    selected = [i for i in dict.fromkeys(body.selected_note_ids) if i][:20]
    if selected:
        pool = await nr.fetch_notes_by_ids(db, user_id, selected)
    else:
        pool = await nr.candidate_pool(db, user_id, body.question)

    focal: dict | None = None
    if body.note_id:
        found = await nr.fetch_notes_by_ids(db, user_id, [body.note_id])
        focal = found[0] if found else None

    ctx = AgentContext(
        db=db, user_id=user_id, question=body.question, history=history, pool=pool,
        tz_offset_minutes=body.tz_offset_minutes, now_utc=now_utc, focal=focal,
        selected_note_ids=selected,
    )

    cid = body.conversation_id or str(uuid.uuid4())

    async def gen():
        answer_parts: list[str] = []
        try:
            # Tell the client the conversation id up front so a new chat can track it.
            yield _sse({"type": "conversation", "id": cid})

            # save_link fast-path: if the message contains a URL, run the planner to check
            # intent before handing off to the agent (zero overhead when no URL present).
            if _URL_RE.search(body.question):
                local_now = now_utc + timedelta(minutes=body.tz_offset_minutes)
                today_str = local_now.strftime("%Y-%m-%d (%A)")
                index = nr.dated_index(pool, body.tz_offset_minutes)
                plan = await gemini_service.plan_ask(body.question, history[-4:], today_str, index)
                if plan.intent == "save_link" and plan.save_url:
                    yield _sse({"type": "tool", "status": "Saving your link…"})
                    try:
                        result = await _save_link_from_chat(db, user_id, plan.save_url, plan.save_hint)
                    except HTTPException as e:
                        yield _sse({"type": "delta", "text": e.detail})
                        yield _sse({"type": "done"})
                        return
                    if result["note_id"]:
                        answer = f'Saved **{result["title"]}**! It\'s now in your notes.'
                        yield _sse({"type": "delta", "text": answer})
                        yield _sse({"type": "saved_note", "note_id": result["note_id"]})
                        try:
                            await persist_exchange(db, user_id, cid, body.question,
                                                   {"text": answer, "citations": [],
                                                    "artifact": None,
                                                    "saved_note_id": result["note_id"]})
                        except Exception:
                            pass
                    else:
                        yield _sse({"type": "delta",
                                    "text": "Your note is being processed — it'll appear in your feed shortly."})
                    yield _sse({"type": "done"})
                    return

            async for ev in run_agent(ctx):
                if ev.get("type") == "delta":
                    answer_parts.append(str(ev.get("text", "")))
                yield _sse(ev)
            citations = _citations_from_ctx(ctx)
            if citations:
                yield _sse({"type": "citations",
                            "citations": [c.model_dump() for c in citations]})
            if ctx.artifact is not None:
                yield _sse({"type": "artifact", "artifact": ctx.artifact.model_dump()})
            # Persist the exchange so the chat can be resumed later (best-effort).
            try:
                await persist_exchange(db, user_id, cid, body.question, {
                    "text": "".join(answer_parts),
                    "citations": [c.model_dump() for c in citations],
                    "artifact": ctx.artifact.model_dump() if ctx.artifact else None,
                })
            except Exception as e:
                log.warning("conversation persist failed: %s: %s", type(e).__name__, e,
                            extra={"user_id": user_id})
            yield _sse({"type": "done"})
        except Exception as e:  # never let an exception abort the stream silently
            log.error("ask_stream failed: %s: %s", type(e).__name__, e,
                      extra={"user_id": user_id})
            yield _sse({"type": "error", "message": "The assistant had trouble answering."})
            yield _sse({"type": "done"})
        finally:
            await flush_usage(user_id, meter)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ──────────────────────────── deep async agent tasks ────────────────────────────

async def _enforce_deep_caps(db, user_id: str) -> None:
    """Per-user + global daily cap on deep tasks (each can fan out to many model calls).
    The global counter is the budget kill-switch; the per-user counter is fair-share."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    transaction = db.transaction()

    @fs.async_transactional
    async def _bump(tx):
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("deep_count", 0)
        global_n = (global_snap.to_dict() or {}).get("deep_count", 0)
        if user_n >= settings.MAX_DEEP_TASKS_PER_USER_PER_DAY:
            raise HTTPException(429, "Daily deep-task limit reached. Try again tomorrow.")
        if global_n >= settings.DAILY_GLOBAL_DEEP_CAP:
            raise HTTPException(429, "Deep tasks are at capacity today. Try again tomorrow.")
        tx.set(user_ref, {"user_id": user_id, "date": today, "deep_count": user_n + 1}, merge=True)
        tx.set(global_ref, {"date": today, "deep_count": global_n + 1}, merge=True)

    await _bump(transaction)


@router.post("/ask/deep", response_model=JobStatus)
async def ask_deep(body: AskRequest, user_id: str = Depends(require_user)):
    """Enqueue a heavy, long-running agent task (e.g. "compile a PRD from all my startup
    notes"). Returns a job_id immediately; the worker runs the agent headlessly
    and writes the result note, which the frontend surfaces via the existing job-watch."""
    db = get_db()
    await _enforce_deep_caps(db, user_id)
    await touch_user_activity(user_id)  # retention signal (best-effort)

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.collection("jobs").document(job_id).set({
        "user_id": user_id,
        "kind": "agent_task",
        "agent_request": {
            "question": body.question,
            "history": [t.model_dump() for t in body.history[-20:]],
            "note_id": body.note_id,
            "selected_note_ids": [i for i in dict.fromkeys(body.selected_note_ids) if i][:20],
            "tz_offset_minutes": body.tz_offset_minutes,
        },
        "status": "pending",
        "note_id": None,
        "error": None,
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    })
    ok = await _dispatch_job(db, job_id, "/api/process-agent")
    return JobStatus(job_id=job_id, status="pending" if ok else "failed")
