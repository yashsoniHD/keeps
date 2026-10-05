import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from google.cloud import firestore as fs
from pydantic import ValidationError

from config import settings
from models.note import IngestRequest, JobStatus
from services.auth_dep import require_user
from services.dispatch import enqueue_process_job
from services.firebase import get_db, touch_user_activity
from services.net_guard import BlockedURLError, assert_public_url_async

router = APIRouter(tags=["ingest"])
log = logging.getLogger("keeps.ingest")


async def _enforce_cost_caps(db, user_id: str, *, skip_note_cap: bool = False) -> bool:
    """Budget guardrails. Returns True when the capture must be *deferred* (parked, not
    processed today) and False when it may proceed now.

    Per-user caps are an abuse backstop and still raise 429. The *global* daily kill-switch,
    however, does NOT reject — erroring a brand-new user on their first save during a launch
    spike is the worst possible first impression. Instead it returns True so the capture is
    queued and drained when budget resets (see /process/drain-deferred). Counters bump
    transactionally; a deferred capture bumps nothing because it consumes no budget today."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")

    # Lifetime note cap excludes is_fallback bookmarks — a capture we couldn't fully process
    # (SSRF block, extraction failure) is salvaged as a thin bookmark the user didn't really
    # ask for, so it must not eat into their real-note budget. is_fallback lives only on those
    # salvage docs (absent on normal notes), and Firestore can't express "!= True OR missing"
    # in one aggregate, so we count all notes minus the fallback ones (both cheap count()s, no
    # doc reads billed).
    # Re-extract overwrites an existing note in place, so the lifetime cap doesn't apply —
    # a user at the note limit must still be able to heal what they already have.
    if not skip_note_cap:
        notes_q = db.collection("notes").where("user_id", "==", user_id)
        total_agg = await notes_q.count().get()
        fallback_agg = await notes_q.where("is_fallback", "==", True).count().get()
        note_count = total_agg[0][0].value - fallback_agg[0][0].value
        if note_count >= settings.MAX_NOTES_PER_USER:
            raise HTTPException(429, "Note limit reached for this account.")

    transaction = db.transaction()

    @fs.async_transactional
    async def _bump(tx) -> bool:
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("ingest_count", 0)
        global_n = (global_snap.to_dict() or {}).get("note_count", 0)
        if user_n >= settings.MAX_INGESTS_PER_USER_PER_DAY:
            raise HTTPException(429, "Daily limit reached. Try again tomorrow.")
        if global_n >= settings.DAILY_GLOBAL_NOTE_CAP:
            return True  # defer — park the capture instead of rejecting it
        tx.set(user_ref, {"user_id": user_id, "date": today, "ingest_count": user_n + 1}, merge=True)
        tx.set(global_ref, {"date": today, "note_count": global_n + 1}, merge=True)
        return False

    return await _bump(transaction)


async def _parse_ingest_request(request: Request) -> IngestRequest:
    """Accepts the capture however the client can deliver it. The web app sends JSON;
    the iOS Shortcut sends headers — JSON dictionary values get silently stripped when
    a signed .shortcut file is imported, while header dictionaries survive intact
    (verified on-device, iOS 18). A bare-text body is the last-ditch fallback.

    JSON-only path: URL captures and typed-text notes. Binary inputs (image/pdf/voice)
    go through /ingest/upload, not here."""
    url = request.headers.get("x-keeps-url", "")
    source = request.headers.get("x-keeps-source", "web")
    input_type = "url"
    text = title = content = note_hint = None
    process_ai = True
    raw = await request.body()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                url = data.get("url") or url
                content = data.get("content")
                source = data.get("source") or source
                note_hint = data.get("note_hint") or None
                input_type = data.get("input_type") or "url"
                text = data.get("text") or None
                title = data.get("title") or None
                # Default True — only an explicit `false` opts a typed note out of AI structuring.
                process_ai = data.get("process_ai", True) is not False
        except json.JSONDecodeError:
            url = url or raw.decode("utf-8", errors="ignore")
    # A URL hiding in the body of a "text" share is still a URL — treat it as one so the
    # full extraction pipeline runs instead of saving the raw link as a plain note. (A
    # save-as-is note keeps the link verbatim — the user opted out of fetching it.)
    if input_type == "text" and process_ai and (text or "").strip().startswith(("http://", "https://")):
        input_type, url = "url", text.strip()
    return IngestRequest(input_type=input_type, url=url, text=text, title=title,
                         content=content, source=source, note_hint=note_hint, process_ai=process_ai)


async def _create_job(db, user_id: str, body: IngestRequest,
                      target_note_id: str | None = None) -> JobStatus:
    """Shared by both ingest endpoints: enforce caps, write the job doc, enqueue the worker.
    When the global daily kill-switch has tripped the capture is parked ("deferred") instead
    of enqueued — drained later once the budget resets — so a launch spike never rejects users.

    `target_note_id` (re-extract): the worker overwrites that existing note in place instead of
    minting a new one (preserving its created_at), so a note captured before an extraction fix
    can be re-healed against its original source_url."""
    deferred = await _enforce_cost_caps(db, user_id, skip_note_cap=target_note_id is not None)
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    status = "deferred" if deferred else "pending"
    job_doc = {
        "user_id": user_id,
        "input_type": body.input_type,    # "url" | "text"
        "url": body.url or None,
        "text": body.text,                # typed-note body (input_type == "text")
        "process_ai": body.process_ai,    # False → save the typed note verbatim (no Gemini)
        "title": body.title,              # user-supplied title (non-url inputs)
        "content": body.content,          # device-extracted text (PWA/shortcut), if any
        "source": body.source,            # "web" | "shortcut" | "pwa" | "ai_chat" | "upload"
        "note_hint": body.note_hint,      # user instructions for Gemini (from Clip AI chat)
        "status": status,                 # "deferred" → parked until budget resets (drain endpoint)
        "note_id": None,
        "error": None,
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    if target_note_id:
        job_doc["target_note_id"] = target_note_id  # re-extract: overwrite this note in place
    await db.collection("jobs").document(job_id).set(job_doc)

    await touch_user_activity(user_id)  # retention signal (best-effort)
    if deferred:
        log.info("ingest deferred (global cap reached) — capture parked",
                 extra={"job_id": job_id, "user_id": user_id, "url": body.url})
        return JobStatus(job_id=job_id, status="deferred")

    # Dev inline path: with no WORKER_SECRET configured (local dev) the worker route would
    # reject us — run the worker in-process so a localhost capture actually processes.
    if not settings.WORKER_SECRET:
        log.info("inline dev processing active (no WORKER_SECRET configured)",
                 extra={"job_id": job_id, "user_id": user_id})
        asyncio.create_task(_run_inline(job_id))
        return JobStatus(job_id=job_id, status="pending")

    # Dispatch off the event loop (the HTTP call is blocking). A dispatch failure must not orphan
    # a "pending" job that renders an eternal "Saving…" card — mark it failed so the client
    # sees a terminal state instead of a 500.
    try:
        await asyncio.to_thread(enqueue_process_job, job_id)
    except Exception as e:  # noqa: BLE001 — any enqueue failure is terminal for this capture
        log.error("enqueue failed, marking job failed: %s: %s", type(e).__name__, e,
                  extra={"job_id": job_id, "user_id": user_id, "url": body.url})
        await db.collection("jobs").document(job_id).update({
            "status": "failed",
            "error": "Couldn't queue this capture for processing. Please try again.",
            "updated_at": datetime.now(timezone.utc),
        })
        return JobStatus(job_id=job_id, status="failed")
    return JobStatus(job_id=job_id, status="pending")


_bg_tasks: set[asyncio.Task] = set()  # strong refs so fire-and-forget tasks aren't GC'd


async def _run_inline(job_id: str) -> None:
    """Dev-only worker invocation (no dispatch hop, so the secret check is bypassed). Best-effort:
    a crash here only affects this one capture, and the job doc already exists."""
    try:
        from routers.process import _process_job  # local import avoids a heavy import cycle
        await _process_job(job_id)
    except Exception as e:  # noqa: BLE001
        log.error("inline dev processing failed: %s: %s", type(e).__name__, e,
                  extra={"job_id": job_id})


async def _redispatch_own_stale(db, user_id: str) -> None:
    """Recovery without waiting for the daily cron: re-dispatch this user's own stale jobs
    (newest 10; age filtering in Python). Best-effort — never blocks the capture."""
    try:
        from routers.process import redispatch_stale  # local import avoids a heavy import cycle
        docs = [d async for d in db.collection("jobs").where("user_id", "==", user_id)
                .order_by("created_at", direction="DESCENDING").limit(10).stream()]
        await redispatch_stale(docs)
    except Exception as e:  # noqa: BLE001
        log.warning("own-stale re-dispatch failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": user_id})


async def _existing_note(db, user_id: str, url: str) -> str | None:
    """Exact-duplicate capture: this user already has a (non-bookmark) note for this canonical
    URL. One indexed equality lookup; a salvaged is_fallback bookmark doesn't count, so re-saving
    a link that failed the first time still retries it. Best-effort — any error is a miss."""
    try:
        async for snap in (db.collection("notes").where("user_id", "==", user_id)
                           .where("source_url", "==", url).limit(1).stream()):
            if not (snap.to_dict() or {}).get("is_fallback"):
                return snap.id
    except Exception as e:  # noqa: BLE001
        log.warning("duplicate lookup failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": user_id, "url": url})
    return None


async def _completed_duplicate_job(db, user_id: str, body: IngestRequest,
                                   note_id: str) -> JobStatus:
    """Write an already-completed job pointing at the existing note, so the frontend's job
    watcher resolves exactly as it does for a fresh save — no caps charged, no AI spend."""
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.collection("jobs").document(job_id).set({
        "user_id": user_id, "input_type": "url", "url": body.url, "source": body.source,
        "status": "completed", "note_id": note_id,
        "destination": {"kind": "note", "note_id": note_id}, "duplicate": True,
        "error": None, "attempt_count": 0, "created_at": now, "updated_at": now,
    })
    log.info("duplicate capture, returning existing note",
             extra={"job_id": job_id, "user_id": user_id, "url": body.url})
    return JobStatus(job_id=job_id, status="completed", note_id=note_id)


@router.post("/ingest", response_model=JobStatus)
async def ingest(request: Request, user_id: str = Depends(require_user)):
    try:
        body = await _parse_ingest_request(request)
    except ValidationError:
        # Manual model construction (headers/raw-body paths) bypasses FastAPI's 422 handling —
        # an over-limit field must be a clean 400, not an unhandled 500.
        raise HTTPException(status_code=400, detail="Capture is too large or malformed.")

    if body.input_type == "text":
        if not (body.text or "").strip():
            raise HTTPException(status_code=400, detail="Note text is empty.")
    else:  # url
        if not body.url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Invalid URL")
        # SSRF gate at the boundary: instant 400 instead of a doomed job (the worker
        # re-checks before fetching, so this is feedback, not the security boundary).
        try:
            await assert_public_url_async(body.url)
        except BlockedURLError:
            raise HTTPException(status_code=400, detail="This URL points at a private address and can't be saved.")

    db = get_db()
    if body.input_type == "url" and (dup := await _existing_note(db, user_id, body.url)):
        out = await _completed_duplicate_job(db, user_id, body, dup)
        out.message = "Already in Keeps ✓"
        return out
    out = await _create_job(db, user_id, body)
    # Fire-and-forget: up to 10 sequential dispatches must not delay the response.
    _bg_tasks.add(t := asyncio.create_task(_redispatch_own_stale(db, user_id)))
    t.add_done_callback(_bg_tasks.discard)
    out.message = _MESSAGES.get(out.status, "Saved to Keeps ✓")
    return out


# Shown verbatim by the iOS Shortcut's notification (errors arrive as `detail` instead).
_MESSAGES = {
    "pending": "Saved to Keeps ✓ — your note is being drafted.",
    "deferred": "Saved to Keeps ✓ — queued, your note will be drafted soon.",
    "failed": "Keeps couldn't start this save. Try again from the app.",
}
