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
from services import sources
from services.embeddings import EMBED_TEXT_VERSION, embedding_service, note_embedding_text
from services.firebase import (
    add_user_category,
    add_user_source,
    firestore_safe,
    flush_usage,
    get_db,
    get_user_categories,
    touch_user_activity,
)
from services.enrich import enrich_note_data
from services.gemini import (ProviderError, VideoUnreadable, closest_existing, gemini_service,
                             job_deadline, match_existing, normalize_slug)
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


class SourceUnreachable(Exception):
    """Every strategy failed to fetch the source — often a one-off network blip, so it is
    retried like any transient failure; only the last attempt salvages a bookmark."""


def _is_transient(e: Exception) -> bool:
    """Failures with a real chance of succeeding on a retry."""
    if isinstance(e, SourceUnreachable):
        return True
    if isinstance(e, (httpx.TimeoutException, httpx.TransportError)):
        return True
    if isinstance(e, openai.APIConnectionError):  # also covers openai timeouts
        return True
    if isinstance(e, ProviderError):  # OpenRouter 200 carrying a provider error / no choices
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
    except Exception:
        pass  # category/source chips are cosmetic — never fail the salvage over it
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


# ponytail: Vercel kills a request at 300 s; leave 30 s of margin.
JOB_DEADLINE_S = 270


async def _extract_from_video(bundle: ContentBundle, video: bytes, mime: str,
                              content_type: str | None,
                              categories: list[str] | None) -> NoteExtraction:
    return await gemini_service.extract_from_video(
        video, mime, bundle.metadata.get("caption") or bundle.text or "",
        list(bundle.metadata.get("comments") or []), content_type, categories=categories)


async def _extract(url: str, bundle: ContentBundle, content_type: str | None,
                   note_hint: str | None, categories: list[str] | None = None
                   ) -> tuple[NoteExtraction, ContentBundle]:
    """Video bytes → the video model; a YouTube URL → the model watches it, falling back to the
    scraper on VideoUnreadable; everything else → the text/vision extract. A video the model
    can't read degrades to a thin caption-only note — a save never fails for a missing video."""
    video = bundle.metadata.pop("video_bytes", None)
    mime = bundle.metadata.pop("video_mime", None) or "video/mp4"
    if video:
        try:
            return (await _extract_from_video(bundle, video, mime, content_type, categories),
                    bundle)
        except VideoUnreadable as e:
            log.info("video unreadable, extracting from caption: %s", e, extra={"url": url})
            if not ((bundle.text or "").strip() or bundle.metadata.get("caption")
                    or bundle.image_parts):
                # Nothing but a URL + platform left: a text extract would invent the note.
                # Raise → the salvage path writes an honest bookmark instead.
                raise ValueError(f"video unreadable and no caption to fall back on: {e}")
            bundle.metadata["thin"] = True
            bundle = bundle.model_copy(update={"strategy": bundle.strategy + "_thin"})
    if bundle.strategy == "youtube_direct":
        try:
            return (await gemini_service.extract_async(url, bundle, content_type, note_hint,
                                                       categories=categories), bundle)
        except VideoUnreadable as e:
            log.info("youtube unreadable, running fallback scraper: %s", e,
                     extra={"url": url, "event": "youtube_fallback"})
            bundle = await sources.youtube.fallback(url, bundle)
            if bundle.kind == "metadata_only":  # nothing to extract from → salvage bookmark
                raise ValueError("youtube unreadable and the fallback found no content")
            return await _extract(url, bundle, content_type, note_hint, categories)
    return (await gemini_service.extract_async(url, bundle, content_type, note_hint,
                                               categories=categories), bundle)


def _hm(seconds: int) -> str:
    h, m = divmod(round(seconds / 60), 60)
    return f"{h} h {m} m" if h and m else f"{h} h" if h else f"{m} m"


def too_long_note(duration: int, limit: int, built_from: str = "caption") -> str:
    """'Video is 2 h 14 m, over the 10-minute limit; note built from the caption.'"""
    length = f"Video is {_hm(duration)}" if duration else "Video is too long"
    return f"{length}, over the {limit // 60}-minute limit; note built from the {built_from}."


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
        if job.get("kind") == "agent_task":  # deep agent tasks were removed with Ask AI
            await doc.reference.update({"status": "failed", "updated_at": now,
                                        "error": "Agent tasks are no longer supported."})
            continue
        try:
            await asyncio.to_thread(enqueue_process_job, doc.id)
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
        if bundle.strategy == "unreachable" and attempt < MAX_TRANSIENT_ATTEMPTS:
            # A one-off fetch failure (a retry moments later usually scrapes fine): retry
            # in-process before settling for a bookmark. BlockedURLError / private_or_blocked
            # never get here.
            raise SourceUnreachable(f"source unreachable: {url}")
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
            schema_slug = extracted.content_type
            cover_image_url = None
        else:
            # 2. Classify against this user's own categories (one lite call, content_type only).
            existing = await get_user_categories(user_id)
            content_type = await gemini_service.classify(url, bundle, existing, note_hint)

            # 3. Type-focused extraction (structured data only — never HTML).
            # The user's categories go to the extractor too: for video sources (classify → None)
            # the model picks the type and should reuse one of them.
            extracted, bundle = await _extract(url, bundle, content_type, note_hint, existing)

            if not extracted.data or len(str(extracted.data)) < 40:
                raise ValueError("Extraction produced empty or suspiciously short data")

            # The extractor is told to ECHO the classified slug; if it drifted to a brand-new
            # category, snap it back to the classifier's choice (which already honours the
            # MAX_USER_CATEGORIES cap). Keeps content_type/template/add_user_category
            # all consistent and guarantees the taxonomy never grows past the cap here.
            # `template` follows the schema the data was BUILT for — taken before any snapping, so
            # a recipe reel snapped onto "summary" at the category cap still renders as a recipe.
            schema_slug = normalize_slug(extracted.content_type or content_type or "summary")
            if content_type is None:
                # Video sources: the model picked the type. Snap the *category* onto the user's
                # taxonomy (and onto the closest existing slug when the category cap is full).
                slug = match_existing(extracted.content_type or "summary", existing)
                if slug not in existing and len(existing) >= settings.MAX_USER_CATEGORIES:
                    slug = closest_existing(slug, existing)
                extracted.content_type = slug
            elif (extracted.content_type != content_type
                    and match_existing(extracted.content_type, existing) not in existing):
                extracted.content_type = content_type

            # No video reached the model (caption/cover only): flag it so the UI can say so.
            if bundle.metadata.get("thin") or bundle.metadata.get("too_long"):
                extracted.data["thin"] = True
            if bundle.metadata.get("too_long"):
                extracted.data["note"] = too_long_note(
                    bundle.metadata.get("duration") or 0,
                    bundle.metadata.get("max_seconds") or settings.MAX_VIDEO_SECONDS,
                    bundle.metadata.get("built_from") or "caption")
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
        # and keeps its created_at while regenerating everything AI produced.
        note_id = target_note_id or _stable_id("note", job_id)
        created_at = now
        if target_note_id:
            existing = await db.collection("notes").document(note_id).get()
            if existing.exists:
                old = existing.to_dict() or {}
                created_at = old.get("created_at") or now
        # Embed title + summary + the (now enriched) data so search matches the note's content,
        # not just its headline.
        embedding = await _note_embedding(extracted.title, extracted.ai_summary, extracted.data)
        note_doc = {
            "user_id": user_id,
            "input_type": input_type,
            "content_type": extracted.content_type,
            # `template` is the immutable structural schema the `data` map was built for.
            # `content_type` is the *editable* category (icon/colour/filter) and may be
            # recategorised by the owner; the render template must NOT follow it, or the
            # data fields (which match this schema) would stop rendering. Set once, here.
            "template": schema_slug,
            "title": extracted.title,
            "ai_summary": extracted.ai_summary,
            "source_url": source_url,
            "source_domain": source_domain,
            "source": source,
            "cover_image_url": cover_image_url,
            "data": firestore_safe(extracted.data),
            "acquisition": bundle.strategy,
            "created_at": created_at,
            "updated_at": now,
        }
        if embedding is not None:
            note_doc["embedding"] = embedding
            note_doc["embedding_version"] = EMBED_TEXT_VERSION
        await db.collection("notes").document(note_id).set(note_doc)
        await add_user_category(user_id, extracted.content_type)
        if source_domain:
            await add_user_source(user_id, source_domain)
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
        # Attribute token spend even when the job re-raised for a retry.
        await flush_usage(user_id, meter)
