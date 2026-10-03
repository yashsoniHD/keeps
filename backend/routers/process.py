"""Worker: the full URL → note pipeline (self-dispatched by services/dispatch.py).

Auth: X-Worker-Secret (services/worker_auth.py); the sweep route also takes the cron bearer.
Idempotent: a retry of a completed job is a no-op, and a concurrent duplicate delivery is
rejected by a transactional claim (409, dropped by the dispatcher), so paid AI work never
runs twice for one job. Retries are in-process (see process_job); a job that outlives its
budget stays "pending" and the sweep route / next ingest re-dispatches it.

Failure ladder (a capture must always produce a note):
  - BlockedURLError (SSRF guard) → failed, no note, no retry. Permanent by design.
  - Transient (model 5xx/429, network timeouts) below MAX_TRANSIENT_ATTEMPTS →
    re-raise as 500; process_job retries in-process (5 s, 10 s) within its time budget.
  - Everything else (and transient at the attempt cap) → salvage: a minimal
    "bookmark" note from whatever metadata is reachable. Only if even the
    salvage Firestore write fails does the job end up failed.
"""
import asyncio
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException, Request
from google.cloud import firestore as fs
from google.cloud.firestore_v1.vector import Vector
import openai

from config import settings
from models.note import ContentBundle, NoteExtraction
from services import note_retrieval as nr
from services import search_index
from services import sources
from services.agent_tools import AgentContext, run_agent_collect
from services.collections import match_collections_by_embedding
from services.embeddings import EMBED_TEXT_VERSION, embedding_service, note_embedding_text
from services.firebase import (
    add_user_category,
    add_user_source,
    firestore_safe,
    flush_usage,
    get_db,
    get_user_categories,
    get_user_collections,
    touch_user_activity,
)
from services.enrich import enrich_note_data
from services.gemini import (gemini_service, job_deadline, is_itinerary, is_places, is_recipe,
                             match_existing, normalize_slug)
from services.item_reconcile import fan_out_note
from services.net_guard import BlockedURLError, guarded_async_client
from services.worker_auth import verify_worker_secret
from services.dispatch import enqueue_process_job
from services.usage_meter import start_metering

router = APIRouter(tags=["process"])
log = logging.getLogger("clipnote.process")


async def _note_embedding(title: str, ai_summary: str = "",
                          data: dict | None = None) -> Vector | None:
    """Embed a note's text (title + summary + flattened data) for semantic search. Non-fatal:
    on any failure the note is still written (search just misses it until a backfill re-embeds
    it)."""
    text = note_embedding_text(title, ai_summary, data)
    if not text:
        return None
    try:
        vec = await embedding_service.embed_document(text)
        return Vector(vec) if vec else None
    except Exception as e:
        log.warning("note embedding failed, writing note without it: %s: %s",
                    type(e).__name__, e)
        return None


async def _match_collections(user_id: str, note_id: str,
                             embedding: Vector | None) -> list[str]:
    """Smart-collection membership at ingest: pure in-memory cosine match between the note's
    already-computed embedding and each of the user's collections' `topic_embedding` (no new
    AI calls). A note with no embedding (embed failure is non-fatal) matches nothing.

    Strictly best-effort: this runs after the paid classify+extract call, so any failure here
    (e.g. a Firestore hiccup in get_user_collections) must never fall through to the generic
    exception handler and salvage the job — that would throw away the extraction we already
    paid for over a purely cosmetic feature. A miss just leaves the note unfiled."""
    if embedding is None:
        return []
    try:
        collections = await get_user_collections(user_id)
    except Exception as e:  # noqa: BLE001 — see docstring: never fail the note over this.
        log.warning("collection matching failed, note will have no collection_ids: %s: %s",
                    type(e).__name__, e, extra={"user_id": user_id, "note_id": note_id})
        return []
    if not collections:
        return []
    return match_collections_by_embedding(list(embedding), note_id, collections)

# A transient failure below this many attempts re-raises as 500 (process_job retries it
# in-process); at the cap it salvages instead — the user gets a note either way.
MAX_TRANSIENT_ATTEMPTS = 3

# Vercel hard-kills a request at 300 s. process_job stops retrying inside JOB_DEADLINE_S (below);
# the job then stays "pending" for the sweep route to re-dispatch.
RETRY_SLEEPS = (5, 10)
MIN_RETRY_S = 60  # don't start another attempt with less than this left in JOB_DEADLINE_S

# A "processing" claim whose heartbeat (updated_at) is older than this is treated as a dead
# run (killed instance) and may be re-claimed. Must exceed the 300 s request kill so a live
# run is never double-claimed.
CLAIM_STALE_SECONDS = 6 * 60

# Sweep thresholds: a "pending" job older than this was never picked up (dispatch lost);
# jobs older than SWEEP_GIVE_UP_S or past SWEEP_MAX_ATTEMPTS are failed, not re-dispatched.
PENDING_STALE_SECONDS = 120
SWEEP_GIVE_UP_S = 24 * 3600
SWEEP_MAX_ATTEMPTS = 5


def _stable_id(kind: str, job_id: str) -> str:
    """Deterministic doc id per (job, kind): if a duplicate delivery ever slips past the
    claim, both runs converge on the same note doc instead of minting an orphan duplicate."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"clipnote:{kind}:{job_id}"))


async def _claim_job(db, job_ref):
    """Transactionally claim a job for this delivery. Dispatch is at-least-once (retry,
    sweep and per-user re-dispatch can overlap) — without a claim both
    runs pass the completed-check and each pays for classification + extraction.

    Returns (job_dict_with_bumped_attempt, None) when claimed, or (None, response) when the
    job is missing/already completed. A job actively claimed by another delivery raises 409 —
    the dispatcher drops it; the winner completes, or dies (stale heartbeat, re-claimable)."""
    transaction = db.transaction()

    @fs.async_transactional
    async def _tx(tx):
        snap = await job_ref.get(transaction=tx)
        if not snap.exists:
            return None, {"status": "missing"}   # permanent — nothing to retry
        job = snap.to_dict()
        if job.get("status") == "completed":
            return None, {"status": "completed", "note_id": job.get("note_id")}
        now = datetime.now(timezone.utc)
        if job.get("status") == "processing":
            updated = job.get("updated_at")
            age = (now - updated).total_seconds() if updated is not None else None
            if age is not None and age < CLAIM_STALE_SECONDS:
                raise HTTPException(409, "Job already claimed by a concurrent delivery")
        attempt = (job.get("attempt_count") or 0) + 1
        tx.set(job_ref, {"status": "processing", "attempt_count": attempt,
                         "updated_at": now}, merge=True)
        return {**job, "attempt_count": attempt}, None

    return await _tx(transaction)


def _is_transient(e: Exception) -> bool:
    """Failures with a real chance of succeeding on a retry."""
    if isinstance(e, (httpx.TimeoutException, httpx.TransportError)):
        return True
    if isinstance(e, openai.APIConnectionError):  # also covers openai timeouts
        return True
    if isinstance(e, openai.APIStatusError):
        return e.status_code == 429 or e.status_code >= 500
    return False


def _domain_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or url).replace("www.", "")
    except ValueError:
        return url


async def _link_preview(url: str) -> dict:
    """Best-effort og:title/og:image fetch for salvage notes. Net-guarded like every
    other outbound fetch; callers treat any failure as 'no preview'."""
    headers = {"User-Agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                              "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
                              "Mobile/15E148 Safari/604.1")}
    async with guarded_async_client(timeout=8.0, follow_redirects=True) as client:
        resp = await client.get(url, headers=headers)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text[:300_000], "html.parser")
    preview: dict = {}
    if tag := soup.find("meta", property="og:title"):
        preview["title"] = tag.get("content")
    elif soup.title and soup.title.string:
        preview["title"] = soup.title.string.strip()
    if tag := soup.find("meta", property="og:image"):
        preview["image"] = tag.get("content")
    return preview


async def _salvage_note(db, *, user_id: str, url: str, source: str, input_type: str,
                        user_title: str | None, bundle: ContentBundle | None,
                        now: datetime, note_id: str | None = None) -> str:
    """Writes a minimal note so the capture is never lost.

    For URL captures: title/cover tiers are bundle metadata → lightweight og: fetch → domain.
    For typed/uploaded captures there's no URL to preview — we fall back to the user's title
    (and, for images, the uploaded image as the cover). Enrichment is best-effort.
    """
    is_url = input_type == "url" and bool(url)
    domain = _domain_of(url) if is_url else ""
    title: str | None = user_title or None
    cover: str | None = None
    try:
        if bundle is not None:
            meta_title = (bundle.metadata or {}).get("title")
            if not title and meta_title and str(meta_title) not in (domain, url, "Untitled"):
                title = str(meta_title)
            cover = bundle.images[0] if bundle.images else None
        if not title and is_url:
            preview = await _link_preview(url)
            title = preview.get("title") or None
            cover = cover or preview.get("image")
    except Exception as e:
        log.warning("salvage enrichment failed, writing minimal note: %s: %s",
                    type(e).__name__, e, extra={"url": url, "user_id": user_id})

    fallback_title = title or domain or "Saved item"
    facts = [{"label": "Source", "value": domain}] if domain else []
    note_id = note_id or str(uuid.uuid4())
    embedding = await _note_embedding(fallback_title)
    note_doc = {
        "user_id": user_id,
        "input_type": input_type,
        "content_type": "bookmark",
        "template": "bookmark",  # generic-block data; renders via GenericNote
        "title": fallback_title,
        "ai_summary": ("Saved as a bookmark — this couldn't be fully processed. "
                       + ("Open the source to read it, or retry from the note."
                          if is_url else "Retry from the note.")),
        "source_url": url if is_url else "",
        "source_domain": domain,
        "source": source,
        "cover_image_url": cover,
        "data": {"facts": facts, "sections": []},
        "acquisition": "salvage",
        "is_fallback": True,
        "created_at": now,
        "updated_at": now,
    }
    if embedding is not None:
        note_doc["embedding"] = embedding
        note_doc["embedding_version"] = EMBED_TEXT_VERSION
    await db.collection("notes").document(note_id).set(note_doc)
    return note_id


async def _salvage_and_complete(db, job_ref, *, job_id: str, user_id: str, url: str,
                                source: str, input_type: str, title: str | None,
                                bundle: ContentBundle | None, now: datetime,
                                error: str) -> dict:
    """Write an honest is_fallback bookmark and mark the job completed with it. Shared by the
    unreachable-source short-circuit and the extraction-failure ladder so both preserve the
    capture identically (stable salvage id → idempotent on a retry)."""
    note_id = await _salvage_note(db, user_id=user_id, url=url, source=source,
                                  input_type=input_type, user_title=title,
                                  bundle=bundle, now=now,
                                  note_id=_stable_id("salvage", job_id))
    try:
        await add_user_category(user_id, "bookmark")
        if input_type == "url" and url:
            await add_user_source(user_id, _domain_of(url))
        # Keep even a salvaged bookmark searchable.
        salvaged = await db.collection("notes").document(note_id).get()
        if salvaged.exists:
            await search_index.upsert_for_note(db, note_id, salvaged.to_dict())
    except Exception:
        pass  # category/source chips + index are cosmetic — never fail the salvage over it
    await job_ref.update({"status": "completed", "note_id": note_id,
                          "destination": {"kind": "note", "note_id": note_id},
                          "error": error[:500],
                          "updated_at": datetime.now(timezone.utc)})
    await touch_user_activity(user_id, first_note=True)  # activation milestone (best-effort)
    return {"status": "completed", "note_id": note_id, "salvaged": True}


async def _fail_reextract(job_ref, error: str) -> dict:
    """A re-extract job whose source can no longer be extracted: mark it failed WITHOUT touching
    the target note. Never salvage — a dead source (deleted IG post, expired page) must not turn a
    good note into a bookmark. Returns 200 so nothing retries a permanent failure."""
    await job_ref.update({"status": "failed", "error": error[:500],
                          "updated_at": datetime.now(timezone.utc)})
    return {"status": "failed", "error": error[:200]}


async def _fail_job(job_ref, error: str) -> dict:
    """Mark a job failed with a machine-readable code (the frontend maps it to a message)."""
    await job_ref.update({"status": "failed", "error": error[:500],
                          "updated_at": datetime.now(timezone.utc)})
    return {"status": "failed", "error": error[:200]}


# ---- completeness gate + escalation (reel cascade) ----
# ponytail: Vercel kills a request at 300 s; leave 30 s of margin. Escalate only when the
# elapsed time + that tier's cost + 45 s (extract/embed/write) still fits.
JOB_DEADLINE_S = 270
MAX_ESCALATIONS = 2
_ESCALATE_COST_S = {"caption": 115, "transcript": 60}  # download+ffmpeg+Whisper / frames+vision
_FINISH_MARGIN_S = 45
_QTY = re.compile(r"\d|[½¼¾⅓⅔]|\b(?:one|two|three|half|dash|pinch|handful|cup|tbsp|tsp)\b", re.I)


def _is_complete(extracted: NoteExtraction, content_type: str) -> bool:
    """Pure heuristic: did extraction capture the substance? Never rejects a note — it only
    decides whether a costlier acquisition tier is worth trying.
    # ponytail: shape/threshold heuristics (recipe >=3 ingredients, >=50% with quantities,
    # >=2 steps; place/itinerary >=1 named stop); tune against real reels, don't over-engineer."""
    data = extracted.data or {}
    if is_recipe(content_type) or "ingredients" in data:
        items: list = []
        for g in data.get("ingredients") or []:
            items += (g.get("items") or []) if isinstance(g, dict) else [g]
        items = [i if isinstance(i, str) else str(i) for i in items]
        quantified = sum(1 for i in items if _QTY.search(i))
        return (len(items) >= 3 and quantified * 2 >= len(items)
                and len(data.get("steps") or []) >= 2)
    if is_places(content_type) or "venues" in data:
        return any(isinstance(v, dict) and v.get("name") for v in data.get("venues") or [])
    if is_itinerary(content_type) or "days" in data:
        return any(isinstance(st, dict) and st.get("place")
                   for d in data.get("days") or [] if isinstance(d, dict)
                   for st in d.get("stops") or [])
    return bool((extracted.ai_summary or "").strip())


def _can_escalate(bundle: ContentBundle, start: float, done: int) -> bool:
    if done >= MAX_ESCALATIONS or not bundle.strategy.startswith("reel_"):
        return False
    cost = _ESCALATE_COST_S.get(bundle.metadata.get("tier", "caption"))
    if cost is None:  # already at the last tier
        return False
    # Request-level deadline when set (survives in-process retries); else this attempt's start.
    end = job_deadline.get() or start + JOB_DEADLINE_S
    if time.monotonic() + cost + _FINISH_MARGIN_S >= end:
        log.info("skipping escalation: over time budget", extra={"strategy": bundle.strategy})
        return False
    return True


async def _escalate(url: str, bundle: ContentBundle, start: float, done: int) -> ContentBundle | None:
    if not _can_escalate(bundle, start, done):
        return None
    try:
        return await sources.escalate(url, bundle)
    except Exception as e:  # noqa: BLE001 — a failed tier keeps the best partial
        log.warning("escalation failed: %s: %s", type(e).__name__, e, extra={"url": url})
        return None


async def _extract_with_escalation(url: str, bundle: ContentBundle, content_type: str,
                                   note_hint: str | None, start: float, done: int = 0):
    """Extract; while the result is incomplete, climb the reel cascade and re-extract (same
    content_type, extract only). Returns (extracted, bundle). The first extract may raise as
    before; later ones never lose the earlier result."""
    extracted = await gemini_service.extract_async(url, bundle, content_type, note_hint)
    while not _is_complete(extracted, content_type):
        nb = await _escalate(url, bundle, start, done)
        if nb is None:
            break
        done += 1
        bundle = nb
        try:
            extracted = await gemini_service.extract_async(url, bundle, content_type, note_hint)
        except Exception as e:  # noqa: BLE001 — keep the best partial
            log.warning("re-extract after escalation failed: %s: %s", type(e).__name__, e)
            break
    return extracted, bundle


def _verify_oidc(request: Request) -> None:
    """Worker-secret gate. Thin wrapper (name kept so existing tests can patch
    process._verify_oidc)."""
    verify_worker_secret(request)


def _raw_text_extraction(text: str, title: str | None) -> NoteExtraction:
    """Build a note from a typed note saved verbatim (process_ai=False) — no Gemini.
    The body keeps the user's text untouched; the title defaults to its first line and the
    summary to a short excerpt (both shown on the feed card, both editable later)."""
    body = text.strip()[:30000]
    first_line = next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
    resolved_title = (title or "").strip() or first_line[:120] or "Note"
    # Excerpt for the card preview — plain text, not an AI summary.
    excerpt = " ".join(body.split())
    summary = excerpt[:200] + ("…" if len(excerpt) > 200 else "")
    return NoteExtraction(content_type="note", title=resolved_title, ai_summary=summary,
                          cover_image_prompt="", data={"body": body})


DRAIN_BATCH = 100  # max deferred jobs re-dispatched per drain pass


async def _drain_deferred(db) -> dict:
    """Re-dispatch captures parked by the global daily cap (status "deferred"), up to the
    budget that has freed up. Bounded by the remaining global budget, so draining can never
    itself bust the kill-switch."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    global_ref = db.collection("system").document(f"usage-{today}")
    snap = await global_ref.get()
    used = (snap.to_dict() or {}).get("note_count", 0)
    budget = settings.DAILY_GLOBAL_NOTE_CAP - used
    if budget <= 0:
        return {"drained": 0, "reason": "no budget today"}

    now = datetime.now(timezone.utc)
    drained = 0
    # ponytail: one pass handles at most DRAIN_BATCH jobs (sequential dispatch inside the 300 s
    # request kill); the daily cron picks up the rest. Raise it only with concurrent dispatch.
    q = db.collection("jobs").where("status", "==", "deferred").limit(min(budget, DRAIN_BATCH))
    async for doc in q.stream():
        try:
            await doc.reference.update({"status": "pending", "updated_at": now})
            await asyncio.to_thread(enqueue_process_job, doc.id)
        except Exception as e:  # noqa: BLE001 — one bad dispatch must not stop the drain
            log.error("drain dispatch failed: %s: %s", type(e).__name__, e,
                      extra={"job_id": doc.id})
            continue  # left "pending" -> the stale sweep re-dispatches it; not charged
        drained += 1
        # Charge per job (atomic) so a later failure/kill never loses the cap count.
        await global_ref.set({"date": today, "note_count": fs.Increment(1)}, merge=True)
    log.info("drained %d deferred captures (budget was %d)", drained, budget)
    return {"drained": drained}


async def redispatch_stale(docs) -> int:
    """Re-dispatch (or give up on) stale jobs from `docs` (job snapshots). A job is stale when
    "pending" > PENDING_STALE_SECONDS or "processing" > CLAIM_STALE_SECONDS since updated_at.
    Jobs past SWEEP_GIVE_UP_S / SWEEP_MAX_ATTEMPTS are marked failed so "Saving…" never sticks.
    Returns the number re-dispatched. Shared by the sweep route and ingest's per-user recovery."""
    now = datetime.now(timezone.utc)
    n = 0
    for doc in docs:
        job = doc.to_dict() or {}
        status = job.get("status")
        limit = {"pending": PENDING_STALE_SECONDS, "processing": CLAIM_STALE_SECONDS}.get(status)
        updated, created = job.get("updated_at"), job.get("created_at")
        if limit is None or updated is None or (now - updated).total_seconds() < limit:
            continue
        if ((created is not None and (now - created).total_seconds() > SWEEP_GIVE_UP_S)
                or (job.get("attempt_count") or 0) >= SWEEP_MAX_ATTEMPTS):
            await doc.reference.update({"status": "failed", "updated_at": now,
                                        "error": job.get("error") or "Timed out before processing."})
            continue
        path = "/api/process-agent" if job.get("kind") == "agent_task" else "/api/process"
        try:
            await asyncio.to_thread(enqueue_process_job, doc.id, path)
            n += 1
        except Exception as e:  # noqa: BLE001 — one bad dispatch must not stop the sweep
            log.error("sweep re-dispatch failed: %s: %s", type(e).__name__, e,
                      extra={"job_id": doc.id})
    return n


async def _reclaim_stale(db) -> int:
    """Stale pending/processing jobs, two single-field equality queries (no new index);
    age filtering happens in Python."""
    n = 0
    for status in ("pending", "processing"):
        docs = [d async for d in db.collection("jobs").where("status", "==", status)
                .limit(100).stream()]
        n += await redispatch_stale(docs)
    return n


# Static routes MUST be declared above /process/{job_id}: Starlette matches in order, and
# the parametrised route would otherwise swallow "sweep" / "drain-deferred" as a job_id.
@router.get("/process/sweep")
async def sweep(request: Request):
    """Daily Vercel cron: unpark deferred captures, then re-dispatch jobs whose worker died."""
    verify_worker_secret(request, allow_cron=True)
    db = get_db()
    try:
        drained = await _drain_deferred(db)
    except Exception as e:  # noqa: BLE001 — never let a drain failure skip the stale reclaim
        log.error("drain failed: %s: %s", type(e).__name__, e)
        drained = {"drained": 0, "error": type(e).__name__}
    reclaimed = await _reclaim_stale(db)
    return {**drained, "redispatched": reclaimed}


@router.post("/process/drain-deferred")
async def drain_deferred(request: Request):
    """Manual trigger for the deferred-capture drain (the sweep route also does this)."""
    _verify_oidc(request)
    return await _drain_deferred(get_db())


@router.post("/process/{job_id}")
async def process_job(job_id: str, request: Request):
    _verify_oidc(request)
    # In-process retry (replaces Cloud Tasks'). Each attempt re-claims via _claim_job, which is
    # idempotent. ponytail: fixed 270 s ceiling under Vercel's 300 s kill; out of budget →
    # 500 and the job stays pending for the sweep / next ingest, upgrade to Vercel Queues
    # if lost-job recovery latency matters.
    start = time.monotonic()
    # extract() reads this to cap each model call's timeout (a ContextVar keeps signatures).
    job_deadline.set(start + JOB_DEADLINE_S)
    for delay in (*RETRY_SLEEPS, None):
        try:
            return await _process_job(job_id)
        except HTTPException as e:
            # A retry needs room for sleep + a useful extract: skip it under MIN_RETRY_S left.
            if (e.status_code != 500 or delay is None
                    or start + JOB_DEADLINE_S - (time.monotonic() + delay) < MIN_RETRY_S):
                raise
        await asyncio.sleep(delay)


async def _process_job(job_id: str) -> dict:
    """The full URL→note pipeline, minus the auth gate. Split out so the dev inline path
    can invoke it directly, and so tests can drive it after stubbing _verify_oidc.
    Idempotency + salvage semantics live here, unchanged."""
    db = get_db()
    job_ref = db.collection("jobs").document(job_id)
    job, early = await _claim_job(db, job_ref)
    if early is not None:
        return early

    user_id: str = job["user_id"]
    input_type: str = job.get("input_type") or "url"
    url: str = job.get("url") or ""
    device_content: str | None = job.get("content")
    title: str | None = job.get("title")
    source: str = job.get("source", "web")
    note_hint: str | None = job.get("note_hint")
    process_ai: bool = job.get("process_ai", True) is not False
    # Re-extract: overwrite this existing note in place instead of minting a new one. On a
    # failed re-extract the salvage path must NEVER clobber it (a dead source must not turn a
    # good note into a bookmark) — guarded at both salvage entry points below.
    target_note_id: str | None = job.get("target_note_id")
    now = datetime.now(timezone.utc)
    # This run's attempt number (bumped by the claim) — the transient ladder below compares
    # it against MAX_TRANSIENT_ATTEMPTS without a second Firestore read.
    attempt = job["attempt_count"]

    # Meter Gemini token spend for this job; flushed once below regardless of outcome
    # (a failed/salvaged job still incurred AI cost that must be attributed).
    meter = start_metering()
    bundle: ContentBundle | None = None
    job_start = time.monotonic()
    try:
        # 1. Acquire content per input_type. URLs go through the source-aware resolver;
        #    typed text is already in hand.
        if input_type == "text":
            bundle = ContentBundle(kind="text", text=(job.get("text") or "")[:30000],
                                   metadata={"title": title or "Note", "platform": source},
                                   strategy="text_input")
        elif device_content:
            # Device-extracted text (PWA/shortcut) already bypassed any paywall/login.
            bundle = ContentBundle(kind="text", text=device_content[:30000],
                                   metadata={"title": url, "platform": source},
                                   strategy="device_content")
        else:
            bundle = await sources.acquire(url)

        # Login-walled / private: nothing but a generic site title came back. Fail honestly —
        # no note, nothing to hallucinate from (a re-extract must not touch the live note).
        if bundle.strategy == "private_or_blocked":
            log.warning("source private or blocked", extra={"job_id": job_id, "user_id": user_id, "url": url})
            return await (_fail_reextract if target_note_id else _fail_job)(
                job_ref, "private_or_blocked")

        # Unreachable source: every strategy failed and the resolver returned only a metadata
        # stub. Do NOT hand it to Gemini — it would confidently hallucinate a whole note from
        # the URL slug (a real 404 produced a full fake recipe). Write an honest is_fallback
        # bookmark and stop: no classify, no extract, no mini-app fan-out.
        if bundle.kind == "metadata_only" or bundle.strategy == "unreachable":
            if target_note_id:
                log.warning("re-extract source unreachable, failing without clobbering the note",
                            extra={"job_id": job_id, "user_id": user_id, "url": url})
                return await _fail_reextract(
                    job_ref, "unreachable: source could not be retrieved (re-extract)")
            log.warning("source unreachable, salvaging bookmark instead of extracting",
                        extra={"job_id": job_id, "user_id": user_id, "url": url})
            return await _salvage_and_complete(
                db, job_ref, job_id=job_id, user_id=user_id, url=url, source=source,
                input_type=input_type, title=title, bundle=bundle,
                now=datetime.now(timezone.utc),
                error="unreachable: content could not be retrieved")

        if input_type == "text" and not process_ai:
            # Save-as-is: skip Gemini entirely. The text is the note; the user titles and
            # categorises it themselves (and can edit the body later). Still embedded below
            # for search — that's not "AI structuring", just retrieval.
            extracted = _raw_text_extraction(job.get("text") or "", title)
            cover_image_url = None
        else:
            # 2. Classify against this user's own categories (one lite call, content_type only —
            #    smart-collection membership is resolved later, by embedding match, not here).
            existing = await get_user_categories(user_id)
            # Gate (a): a reel with a thin preview would be misclassified — climb one tier first.
            escalations = 0
            if (bundle.strategy.startswith("reel_") and not bundle.image_parts
                    and len(bundle.text or "") < sources.social_video.THIN_CHARS):
                if (nb := await _escalate(url, bundle, job_start, escalations)) is not None:
                    bundle, escalations = nb, escalations + 1
                elif not (bundle.text or "").strip() and not bundle.image_parts:
                    # Nothing escalated and nothing usable: extracting would invent a note.
                    log.warning("thin reel, escalation failed", extra={
                        "job_id": job_id, "user_id": user_id, "url": url})
                    return await (_fail_reextract if target_note_id else _fail_job)(
                        job_ref, "private_or_blocked")
            content_type = await gemini_service.classify(url, bundle, existing, note_hint)

            # 3. Type-focused extraction (structured data only — never HTML); gate (b)
            #    escalates the reel cascade when the result is incomplete.
            extracted, bundle = await _extract_with_escalation(
                url, bundle, content_type, note_hint, job_start, escalations)

            if not extracted.data or len(str(extracted.data)) < 40:
                raise ValueError("Extraction produced empty or suspiciously short data")

            # The extractor is told to ECHO the classified slug; if it drifted to a brand-new
            # category, snap it back to the classifier's choice (which already honours the
            # MAX_USER_CATEGORIES cap). Keeps content_type/template/search-index/add_user_category
            # all consistent and guarantees the taxonomy never grows past the cap here.
            if (extracted.content_type != content_type
                    and match_existing(extracted.content_type, existing) not in existing):
                extracted.content_type = content_type

            cover_image_url = bundle.images[0] if bundle.images else None
        # source_url/domain only describe URL captures; a typed note has
        # no web source, so they stay "" (the same empty-source convention AI notes use) and
        # the UI omits the "View source" affordance.
        canonical = bundle.metadata.get("canonical_url") or url
        source_url = canonical if input_type == "url" else ""
        source_domain = (canonical.split("/")[2].replace("www.", "")
                         if input_type == "url" and "://" in canonical else "")

        # Enrich the note's own data per its content family (TMDB providers, Places
        # photos/coords + action links, stop geocoding, price parsing). Best-effort: a miss
        # leaves a valid plain note. A poster/photo is adopted as cover only when the note
        # would otherwise be coverless.
        if process_ai:
            extracted.data, cover_override = await enrich_note_data(
                user_id, extracted.content_type, extracted.data, cover_image_url)
            cover_image_url = cover_override or cover_image_url

        # Every capture is a note. A re-extract targets the existing note (overwrite in place)
        # and must preserve owner-set state — created_at plus any flag the owner toggled through
        # a dedicated action (favorite/pinned/public) — while still regenerating everything AI
        # produced (title/summary/data/content_type/cover). `collection_ids`/`collection_id`
        # need no special-casing: `_match_collections` below re-derives them for this SAME
        # note_id, and pin/exclude overrides are keyed by note_id on the collection doc, so a
        # manually pinned/excluded note stays pinned/excluded automatically. `user_note` lives
        # in a separate annotations/{note_id} doc and is untouched by this write.
        note_id = target_note_id or _stable_id("note", job_id)
        created_at = now
        preserved: dict = {}
        if target_note_id:
            existing = await db.collection("notes").document(note_id).get()
            if existing.exists:
                old = existing.to_dict() or {}
                created_at = old.get("created_at") or now
                for field in ("is_favorite", "is_public", "pinned_at"):
                    if field in old:
                        preserved[field] = old[field]
        # Embed title + summary + the (now enriched) data so search matches the note's content,
        # not just its headline.
        embedding = await _note_embedding(extracted.title, extracted.ai_summary, extracted.data)
        # Smart-bucket membership: pure in-memory cosine match against the user's collections'
        # topic_embedding (no new AI calls). A note can now belong to more than one collection;
        # the legacy scalar `collection_id` is kept coherent (first match, or null) for the
        # not-yet-migrated frontend/API surface.
        collection_ids = await _match_collections(user_id, note_id, embedding)
        collection_id = collection_ids[0] if collection_ids else None
        note_doc = {
            "user_id": user_id,
            "input_type": input_type,
            "content_type": extracted.content_type,
            # `template` is the immutable structural schema the `data` map was built for.
            # `content_type` is the *editable* category (icon/colour/filter) and may be
            # recategorised by the owner; the render template must NOT follow it, or the
            # data fields (which match this schema) would stop rendering. Set once, here.
            "template": extracted.content_type,
            "title": extracted.title,
            "ai_summary": extracted.ai_summary,
            "source_url": source_url,
            "source_domain": source_domain,
            "source": source,
            "cover_image_url": cover_image_url,
            # Smart-bucket membership by embedding match; collection_id is the legacy scalar
            # (deprecated shim, first match or null) kept coherent with collection_ids.
            "collection_ids": collection_ids,
            "collection_id": collection_id,
            "data": firestore_safe(extracted.data),
            "acquisition": bundle.strategy,
            "created_at": created_at,
            "updated_at": now,
            **preserved,   # re-extract only: is_favorite/is_public/pinned_at carried over
        }
        if embedding is not None:
            note_doc["embedding"] = embedding
            note_doc["embedding_version"] = EMBED_TEXT_VERSION
        await db.collection("notes").document(note_id).set(note_doc)
        # Keep the note searchable + Clip-AI-answerable (reuse its embedding, no second embed call).
        await search_index.upsert_for_note(db, note_id, note_doc, embedding)
        await add_user_category(user_id, extracted.content_type)
        if source_domain:
            await add_user_source(user_id, source_domain)
        # Fan the note out into its mini-app family (watch/place_items) so it
        # shows on the walls and the poster deep-links resolve. `note_doc.data` already carries
        # the enriched payload from enrich_note_data above, so this re-runs no Gemini extraction
        # and no fresh TMDB/Places spend. Idempotent (stable item ids) and best-effort — the
        # note is written; a fan-out failure must not fail the job.
        try:
            await fan_out_note(user_id, note_id, note_doc)
        except Exception as e:  # noqa: BLE001 — belt over fan_out_note's own per-family catch.
            log.warning("mini-app fan-out failed: %s: %s", type(e).__name__, e,
                        extra={"job_id": job_id, "user_id": user_id, "url": url})
        destination = {"kind": "note", "note_id": note_id}
        await job_ref.update({"status": "completed", "note_id": note_id,
                              "destination": destination,
                              "title": extracted.title,
                              "updated_at": datetime.now(timezone.utc)})
        await touch_user_activity(user_id, first_note=True)  # activation milestone (best-effort)
        log.info("note created (%s via %s)", extracted.content_type, bundle.strategy,
                 extra={"job_id": job_id, "user_id": user_id, "url": url, "strategy": bundle.strategy})
        return {"status": "completed", "note_id": note_id, "destination": destination}

    except BlockedURLError as e:
        # SSRF guard or unsupported scheme — permanent and deliberate: no note, no retry.
        log.warning("blocked URL, failing without a note: %s", e,
                    extra={"job_id": job_id, "user_id": user_id, "url": url})
        await job_ref.update({"status": "failed", "error": f"BlockedURL: {e}"[:500],
                              "updated_at": datetime.now(timezone.utc)})
        return {"status": "failed", "error": str(e)[:200]}

    except Exception as e:
        if _is_transient(e) and attempt < MAX_TRANSIENT_ATTEMPTS:
            # process_job retries in-process. Status returns to "pending" so the feed keeps showing the in-flight card, not a failure.
            log.warning("transient failure (attempt %d/%d), re-raising for retry: %s: %s",
                        attempt, MAX_TRANSIENT_ATTEMPTS, type(e).__name__, e,
                        extra={"job_id": job_id, "user_id": user_id, "url": url})
            await job_ref.update({"status": "pending",
                                  "error": f"transient: {type(e).__name__}: {e}"[:500],
                                  "updated_at": datetime.now(timezone.utc)})
            raise HTTPException(500, "Transient failure — will retry")

        # A re-extract that failed permanently must NOT salvage — that would replace the
        # existing note with a bookmark. Fail the job and leave the note untouched.
        if target_note_id:
            log.warning("re-extract failed, failing job without clobbering the note: %s: %s",
                        type(e).__name__, e,
                        extra={"job_id": job_id, "user_id": user_id, "url": url})
            return await _fail_reextract(job_ref, f"reextract failed: {type(e).__name__}: {e}")

        # Permanent extraction failure (or transient at the cap) → salvage a bookmark
        # note. The capture is preserved even when the AI pipeline can't deliver.
        log.error("process job failed, salvaging bookmark note: %s: %s", type(e).__name__, e,
                  extra={"job_id": job_id, "user_id": user_id, "url": url}, exc_info=True)
        try:
            return await _salvage_and_complete(
                db, job_ref, job_id=job_id, user_id=user_id, url=url, source=source,
                input_type=input_type, title=title, bundle=bundle,
                now=datetime.now(timezone.utc),
                error=f"salvaged: {type(e).__name__}: {e}")
        except Exception as salvage_exc:
            # Even the URL-only Firestore write failed — the one path left is "failed".
            log.error("salvage write failed: %s: %s", type(salvage_exc).__name__, salvage_exc,
                      extra={"job_id": job_id, "user_id": user_id, "url": url}, exc_info=True)
            await job_ref.update({"status": "failed", "error": f"{type(e).__name__}: {e}"[:500],
                                  "updated_at": datetime.now(timezone.utc)})
            return {"status": "failed", "error": str(e)[:200]}

    finally:
        sources.cleanup(bundle)
        # Attribute token spend even when the job re-raised for a retry.
        await flush_usage(user_id, meter)


@router.post("/process-agent/{job_id}")
async def process_agent_job(job_id: str, request: Request):
    """Deep async agent worker: runs the orchestrator headlessly for a heavy multi-note task
    (e.g. a PRD over 15 notes) and writes the result as a note. Same worker-secret auth + idempotency as the
    URL pipeline. Deep tasks don't retry-storm: any failure marks the job failed (HTTP 200)."""
    _verify_oidc(request)

    db = get_db()
    job_ref = db.collection("jobs").document(job_id)
    job, early = await _claim_job(db, job_ref)
    if early is not None:
        return early

    user_id: str = job["user_id"]
    req: dict = job.get("agent_request") or {}
    question: str = req.get("question", "")
    history: list = req.get("history", [])
    selected: list = req.get("selected_note_ids", []) or []
    tz: int = req.get("tz_offset_minutes", 0)
    now = datetime.now(timezone.utc)

    meter = start_metering()
    try:
        pool = (await nr.fetch_notes_by_ids(db, user_id, selected) if selected
                else await nr.candidate_pool(db, user_id, question))
        focal = None
        if req.get("note_id"):
            found = await nr.fetch_notes_by_ids(db, user_id, [req["note_id"]])
            focal = found[0] if found else None

        ctx = AgentContext(
            db=db, user_id=user_id, question=question, history=history, pool=pool,
            tz_offset_minutes=tz, now_utc=now, focal=focal, selected_note_ids=selected,
            max_grounded=settings.DEEP_MAX_NOTES, max_rounds=settings.DEEP_MAX_ROUNDS,
        )
        result = await run_agent_collect(ctx)
        if result.get("error") and ctx.artifact is None and not result.get("text"):
            raise RuntimeError(result["error"])

        # Prefer the structured artifact the agent built; else wrap its prose answer.
        if ctx.artifact is not None:
            title = ctx.artifact.title or (question[:80] or "Agent result")
            ai_summary = ctx.artifact.ai_summary or ""
            content_type = ctx.artifact.content_type or "summary"
            data = ctx.artifact.data or {}
        else:
            title = (question[:80] or "Agent result")
            ai_summary = ""
            content_type = "summary"
            data = {"sections": [{"heading": "Result",
                                  "items": [result.get("text") or "No content generated."]}]}

        slug = match_existing(normalize_slug(content_type), await get_user_categories(user_id))
        new_id = _stable_id("agent-note", job_id)
        embedding = await _note_embedding(title, ai_summary, data)
        collection_ids = await _match_collections(user_id, new_id, embedding)
        collection_id = collection_ids[0] if collection_ids else None
        note_doc = {
            "user_id": user_id,
            "content_type": slug,
            "template": "composed",
            "title": title,
            "ai_summary": ai_summary,
            "source_url": "",
            "source_domain": "",
            "source": "ai",
            "cover_image_url": None,
            "data": firestore_safe(data),
            "acquisition": "ai_deep_task",
            # AI-authored notes still get matched by embedding, same as any other note.
            "collection_ids": collection_ids,
            "collection_id": collection_id,
            "source_note_ids": list(dict.fromkeys(ctx.cited_ids))[:50],
            "created_at": now,
            "updated_at": datetime.now(timezone.utc),
        }
        if embedding is not None:
            note_doc["embedding"] = embedding
            note_doc["embedding_version"] = EMBED_TEXT_VERSION
        await db.collection("notes").document(new_id).set(note_doc)
        await search_index.upsert_for_note(db, new_id, note_doc, embedding)
        await add_user_category(user_id, slug)
        await job_ref.update({"status": "completed", "note_id": new_id,
                              "destination": {"kind": "note", "note_id": new_id},
                              "title": title,
                              "updated_at": datetime.now(timezone.utc)})
        log.info("deep agent task completed", extra={"job_id": job_id, "user_id": user_id})
        return {"status": "completed", "note_id": new_id}

    except Exception as e:
        log.error("deep agent task failed: %s: %s", type(e).__name__, e,
                  extra={"job_id": job_id, "user_id": user_id}, exc_info=True)
        await job_ref.update({"status": "failed", "error": f"{type(e).__name__}: {e}"[:500],
                              "updated_at": datetime.now(timezone.utc)})
        return {"status": "failed", "error": str(e)[:200]}
    finally:
        await flush_usage(user_id, meter)
