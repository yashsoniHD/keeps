import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from google.cloud import firestore as fs
from pydantic import ValidationError

from config import settings
from models.note import IngestRequest, JobStatus
from services import uploads
from services.auth_dep import require_user
from services.cloud_tasks import enqueue_process_job
from services.firebase import get_db, touch_user_activity
from services.net_guard import BlockedURLError, assert_public_url_async

router = APIRouter(tags=["ingest"])
log = logging.getLogger("clipnote.ingest")


async def _enforce_cost_caps(db, user_id: str) -> bool:
    """Budget guardrails. Returns True when the capture must be *deferred* (parked, not
    processed today) and False when it may proceed now.

    Per-user caps are an abuse backstop and still raise 429. The *global* daily kill-switch,
    however, does NOT reject — erroring a brand-new user on their first save during a launch
    spike is the worst possible first impression. Instead it returns True so the capture is
    queued and drained when budget resets (see /process/drain-deferred). Counters bump
    transactionally; a deferred capture bumps nothing because it consumes no budget today."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")

    notes_q = db.collection("notes").where("user_id", "==", user_id)
    agg = await notes_q.count().get()
    note_count = agg[0][0].value
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
    url = request.headers.get("x-clipnote-url", "")
    source = request.headers.get("x-clipnote-source", "web")
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


async def _create_job(db, user_id: str, body: IngestRequest) -> JobStatus:
    """Shared by both ingest endpoints: enforce caps, write the job doc, enqueue the worker.
    When the global daily kill-switch has tripped the capture is parked ("deferred") instead
    of enqueued — drained later once the budget resets — so a launch spike never rejects users."""
    deferred = await _enforce_cost_caps(db, user_id)
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    status = "deferred" if deferred else "pending"
    await db.collection("jobs").document(job_id).set({
        "user_id": user_id,
        "input_type": body.input_type,    # "url" | "text" | "image" | "pdf" | "voice"
        "url": body.url or None,
        "text": body.text,                # typed-note body (input_type == "text")
        "process_ai": body.process_ai,    # False → save the typed note verbatim (no Gemini)
        "title": body.title,              # user-supplied title (non-url inputs)
        "media_gcs_uri": body.media_gcs_uri,    # gs:// of the uploaded file
        "media_mime": body.media_mime,          # MIME for the worker's FileData part
        "media_cover_url": body.media_cover_url,  # public cover (images)
        "content": body.content,          # device-extracted text (PWA/shortcut), if any
        "source": body.source,            # "web" | "shortcut" | "pwa" | "ai_chat" | "upload"
        "note_hint": body.note_hint,      # user instructions for Gemini (from Clip AI chat)
        "status": status,                 # "deferred" → parked until budget resets (drain endpoint)
        "note_id": None,
        "error": None,
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    })

    await touch_user_activity(user_id)  # retention signal (best-effort)
    if deferred:
        log.info("ingest deferred (global cap reached) — capture parked",
                 extra={"job_id": job_id, "user_id": user_id, "url": body.url})
        return JobStatus(job_id=job_id, status="deferred")

    enqueue_process_job(job_id)
    return JobStatus(job_id=job_id, status="pending")


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

    return await _create_job(get_db(), user_id, body)


@router.post("/ingest/upload", response_model=JobStatus)
async def ingest_upload(
    file: UploadFile = File(...),
    input_type: str = Form(...),
    title: str | None = Form(None),
    source: str = Form("upload"),
    note_hint: str | None = Form(None),
    user_id: str = Depends(require_user),
):
    """Binary capture path: a screenshot/image, PDF, voice memo, or video shared into the
    app. Uploads the bytes to GCS, then creates the same job shape the URL path does so the
    worker pipeline is identical from here on."""
    if input_type not in ("image", "pdf", "voice", "video"):
        raise HTTPException(status_code=400, detail="Unsupported upload type.")
    if not uploads.bucket_for(input_type):
        raise HTTPException(status_code=503, detail="File uploads aren't configured on this server.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    # Video gets a larger ceiling than images/PDFs — even a short clip dwarfs a screenshot,
    # while the per-input cap still bounds the Gemini token cost of a single capture.
    cap_mb = settings.MAX_VIDEO_UPLOAD_MB if input_type == "video" else settings.MAX_UPLOAD_MB
    if len(data) > cap_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File too large (max {cap_mb} MB).")
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in settings.ALLOWED_UPLOAD_MIME.get(input_type, set()):
        raise HTTPException(status_code=415, detail=f"Unsupported {input_type} format ({mime or 'unknown'}).")

    gs_uri, cover_url = await uploads.store_upload(input_type, data, mime)
    body = IngestRequest(
        input_type=input_type, source=source, title=title, note_hint=note_hint,
        media_gcs_uri=gs_uri, media_mime=mime, media_cover_url=cover_url,
    )
    return await _create_job(get_db(), user_id, body)
