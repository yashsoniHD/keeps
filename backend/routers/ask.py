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
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore as fs
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from models.ask import AskPlan, AskRequest, AskResponse, Citation
from services.auth_dep import require_user
from services.embeddings import embedding_service
from services.firebase import flush_usage, get_db
from services.gemini import gemini_service, normalize_slug
from services.source_alias import source_matches
from services.usage_meter import start_metering

log = logging.getLogger("clipnote.ask")

router = APIRouter(tags=["ask"])

NO_NOTES_ANSWER = (
    "You haven't saved any notes yet — clip a few links first, then ask me about them."
)
NOTHING_FOUND_ANSWER = "I couldn't find anything in your notes about that."

# Index fields the planner and citations need, WITHOUT the heavy `data` map (projection
# keeps the candidate-pool read cheap). created_at lets the planner reason about dates.
INDEX_FIELDS = ["content_type", "title", "ai_summary", "source_domain", "cover_image_url", "created_at"]

_PERIOD_LABELS = {
    "today": "today", "yesterday": "yesterday", "this_week": "this week",
    "last_week": "last week", "this_month": "this month", "recent": "recently",
}

# Brand-aware source matching ("find my Pinterest notes" → pin.it short links) lives in a
# shared module so the search bar resolves the same aliases. See services/source_alias.py.


def _period_label(period: str) -> str:
    return _PERIOD_LABELS.get(period, "then")


def _period_bounds(period: str, tz_offset_minutes: int,
                   now_utc: datetime) -> tuple[datetime, datetime] | None:
    """Resolve a period keyword to a [after, before) UTC window using the user's local day.
    The model only picks the keyword; the date math is done here (deterministic)."""
    offset = timedelta(minutes=tz_offset_minutes)
    local_now = now_utc + offset
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    def to_utc(local_dt: datetime) -> datetime:
        return local_dt - offset  # local = utc + offset  ⇒  utc = local - offset

    if period == "today":
        return to_utc(local_midnight), now_utc
    if period == "yesterday":
        return to_utc(local_midnight - timedelta(days=1)), to_utc(local_midnight)
    if period == "this_week":
        week_start = local_midnight - timedelta(days=local_now.weekday())
        return to_utc(week_start), now_utc
    if period == "last_week":
        week_start = local_midnight - timedelta(days=local_now.weekday())
        return to_utc(week_start - timedelta(days=7)), to_utc(week_start)
    if period == "this_month":
        return to_utc(local_midnight.replace(day=1)), now_utc
    if period == "recent":
        return now_utc - timedelta(days=7), now_utc
    return None


def _type_variants(content_types: list[str]) -> list[str]:
    """Normalize requested type slugs + singular/plural variants (planner may say
    'recipes' while notes store 'recipe'). Capped at 10 for Firestore `in` queries."""
    variants: list[str] = []
    for t in content_types:
        n = normalize_slug(t)
        for v in (n, n.rstrip("s"), n + "s"):
            if v and v not in variants:
                variants.append(v)
    return variants[:10]


def _filter_types(notes: list[dict], content_types: list[str]) -> list[dict]:
    if not content_types:
        return notes
    targets = set(_type_variants(content_types))
    return [n for n in notes if normalize_slug(n.get("content_type", "")) in targets]


async def _recent_notes(db, user_id: str, limit: int) -> list[dict]:
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING")
        .limit(limit).select(INDEX_FIELDS)
    )
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


async def _vector_shortlist(db, user_id: str, question: str) -> list[dict] | None:
    """Top-K candidate notes by semantic similarity (Firestore Vector Search). Returns
    None when the query embedding is unavailable so the caller falls back to recency alone."""
    try:
        query_vec = await embedding_service.embed_query(question)
    except Exception as e:
        log.warning("ask shortlist embedding failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": user_id})
        return None
    if not query_vec:
        return None
    vector_query = db.collection("notes").where("user_id", "==", user_id).find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_vec),
        distance_measure=DistanceMeasure.COSINE,
        limit=settings.ASK_SHORTLIST_K,
    )
    return [
        {"id": doc.id, **{f: (doc.to_dict() or {}).get(f) for f in INDEX_FIELDS}}
        async for doc in vector_query.stream()
    ]


async def _candidate_pool(db, user_id: str, question: str) -> list[dict]:
    """Notes the planner chooses from: most-recent (temporal coverage) ∪ vector top-K
    (deep-semantic coverage), deduped by id."""
    recent = await _recent_notes(db, user_id, settings.ASK_RECENT_POOL)
    pool = {n["id"]: n for n in recent}
    shortlist = await _vector_shortlist(db, user_id, question)
    if shortlist:
        for n in shortlist:
            pool.setdefault(n["id"], n)
    return list(pool.values())


def _dated_index(pool: list[dict], tz_offset_minutes: int) -> list[dict]:
    offset = timedelta(minutes=tz_offset_minutes)
    index = []
    for n in pool:
        created = n.get("created_at")
        saved = ""
        if created is not None:
            try:
                saved = (created + offset).strftime("%Y-%m-%d")
            except Exception:
                saved = ""
        index.append({
            "id": n["id"],
            "type": n.get("content_type", ""),
            "title": n.get("title", ""),
            "summary": (n.get("ai_summary") or "")[:200],
            "saved": saved,
        })
    return index


async def _fetch_notes_by_ids(db, user_id: str, ids: list[str]) -> list[dict]:
    snaps = await asyncio.gather(
        *(db.collection("notes").document(note_id).get() for note_id in ids)
    )
    notes = []
    for note_id, snap in zip(ids, snaps):
        data = snap.to_dict() if snap.exists else None
        if data and data.get("user_id") == user_id:
            notes.append({"id": note_id, **data})
    return notes


async def _fetch_notes_by_window(db, user_id: str, after: datetime, before: datetime,
                                 cap: int) -> list[dict]:
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .where("created_at", ">=", after).where("created_at", "<", before)
        .order_by("created_at", direction="DESCENDING").limit(cap)
    )
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


async def _fetch_notes_by_source(db, user_id: str, source: str, cap: int) -> list[dict]:
    """Notes from a named source ("my Pinterest notes"). Firestore can't substring-match,
    so scan the newest notes (using the existing user_id+created_at index) and filter in
    Python — cheap reads, no extra index, tolerant of subdomains and a stale `sources` list.
    Matches on the canonical brand (so pin.it counts as pinterest, youtu.be as youtube) and
    keeps a raw substring check for anything the alias map doesn't know about."""
    keyword = source.lower().strip()
    if not keyword:
        return []
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING").limit(300)
    )
    matched = []
    async for doc in query.stream():
        domain = ((doc.to_dict() or {}).get("source_domain") or "").lower()
        if source_matches(domain, keyword):
            matched.append({"id": doc.id, **doc.to_dict()})
            if len(matched) >= cap:
                break
    return matched


async def _fetch_notes_by_types(db, user_id: str, content_types: list[str],
                                cap: int) -> list[dict]:
    variants = _type_variants(content_types)
    if not variants:
        return []
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .where("content_type", "in", variants)
        .order_by("created_at", direction="DESCENDING").limit(cap)
    )
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


async def _retrieve_notes(db, user_id: str, plan: AskPlan, pool: list[dict],
                          tz_offset_minutes: int, now_utc: datetime) -> tuple[list[dict], int]:
    """Build the grounding note set from the plan. Returns (notes_to_answer_from,
    total_matched) so the caller can report coverage when the set was capped."""
    # Source-scoped ("my Pinterest notes"), optionally narrowed by type.
    if plan.source:
        matched = await _fetch_notes_by_source(db, user_id, plan.source,
                                               settings.ASK_EXHAUSTIVE_CAP)
        matched = _filter_types(matched, plan.content_types)
        cap = settings.ASK_EXHAUSTIVE_CAP if plan.exhaustive else settings.ASK_MAX_GROUNDED_NOTES
        return matched[:cap], len(matched)

    # Temporal: date-bounded query (optionally narrowed by type).
    if plan.period:
        bounds = _period_bounds(plan.period, tz_offset_minutes, now_utc)
        if bounds:
            after, before = bounds
            matched = await _fetch_notes_by_window(db, user_id, after, before,
                                                   settings.ASK_EXHAUSTIVE_CAP)
            matched = _filter_types(matched, plan.content_types)
            cap = settings.ASK_EXHAUSTIVE_CAP if plan.exhaustive else settings.ASK_MAX_GROUNDED_NOTES
            return matched[:cap], len(matched)

    # Exhaustive / aggregate by type: the full filtered set, not a top-K shortlist.
    if plan.content_types and (plan.exhaustive or plan.intent == "aggregate"):
        matched = await _fetch_notes_by_types(db, user_id, plan.content_types,
                                              settings.ASK_EXHAUSTIVE_CAP)
        return matched[: settings.ASK_EXHAUSTIVE_CAP], len(matched)

    # Semantic: the planner's picks from the candidate pool.
    known = {n["id"] for n in pool}
    ids = [i for i in dict.fromkeys(plan.note_ids) if i in known][: settings.ASK_MAX_GROUNDED_NOTES]
    if not ids:
        return [], 0
    notes = await _fetch_notes_by_ids(db, user_id, ids)
    return notes, len(notes)


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


@router.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest, user_id: str = Depends(require_user)):
    db = get_db()
    history = [t.model_dump() for t in body.history[-10:]]
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc + timedelta(minutes=body.tz_offset_minutes)
    today_str = local_now.strftime("%Y-%m-%d (%A)")

    pool = await _candidate_pool(db, user_id, body.question)

    await _enforce_ask_caps(db, user_id)
    meter = start_metering()  # both Gemini stages; flushed once when the request ends
    try:
        index = _dated_index(pool, body.tz_offset_minutes)
        plan = await gemini_service.plan_ask(body.question, history[-4:], today_str, index)

        # Focal note: chat opened from a note's page. Fetch it (ownership-checked) so it can
        # be forced into the grounding set and ranked first. A stale/foreign id is ignored.
        focal: dict | None = None
        if body.note_id:
            found = await _fetch_notes_by_ids(db, user_id, [body.note_id])
            focal = found[0] if found else None

        # Create-a-note: author a draft from the whole conversation (a wider window than the
        # answer stages get) and return it as a savable artifact — no retrieval needed.
        if plan.intent == "create":
            full_history = [t.model_dump() for t in body.history]
            artifact = await gemini_service.create_note(body.question, full_history)
            return AskResponse(answer="Here's a draft — save it if it looks right:",
                               artifact=artifact)

        # Opening Ask from inside a note means it's note-grounded even for terse prompts
        # ("summarize this"), so a focal note overrides a "general" plan.
        if focal:
            plan.scope = "notes"

        # General conversation / general-knowledge → answer plainly, no notes, no citations.
        if plan.scope == "general":
            return AskResponse(answer=await _general_answer(body.question, history))

        notes, matched_total = await _retrieve_notes(
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
                synth = await gemini_service.synthesize(body.question, history, notes,
                                                        plan.output, focal_title)
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
            )
            for cid in dict.fromkeys(cited_ids)
            if cid in by_id
        ]
        return AskResponse(answer=answer_md, citations=citations,
                           coverage=coverage, artifact=artifact)
    finally:
        await flush_usage(user_id, meter)
