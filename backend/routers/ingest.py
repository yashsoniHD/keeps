import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from google.cloud import firestore as fs

from config import settings
from models.note import IngestRequest, JobStatus
from services import uploads
from services.auth_dep import require_user
from services.cloud_tasks import enqueue_process_job
from services.firebase import get_db
from services.net_guard import BlockedURLError, assert_public_url_async

router = APIRouter(tags=["ingest"])


async def _enforce_cost_caps(db, user_id: str) -> None:
    """Budget guardrails: per-user note cap, per-user daily ingest cap, global daily
    kill-switch. Raises 429 when a limit is hit. Counters bump transactionally."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")

    notes_q = db.collection("notes").where("user_id", "==", user_id)
    agg = await notes_q.count().get()
    note_count = agg[0][0].value
    if note_count >= settings.MAX_NOTES_PER_USER:
        raise HTTPException(429, "Note limit reached for this account.")

    transaction = db.transaction()

    @fs.async_transactional
    async def _bump(tx):
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("ingest_count", 0)
        global_n = (global_snap.to_dict() or {}).get("note_count", 0)
        if user_n >= settings.MAX_INGESTS_PER_USER_PER_DAY:
            raise HTTPException(429, "Daily limit reached. Try again tomorrow.")
        if global_n >= settings.DAILY_GLOBAL_NOTE_CAP:
            raise HTTPException(429, "Service is at capacity today. Try again tomorrow.")
        tx.set(user_ref, {"user_id": user_id, "date": today, "ingest_count": user_n + 1}, merge=True)
        tx.set(global_ref, {"date": today, "note_count": global_n + 1}, merge=True)

    await _bump(transaction)


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
        except json.JSONDecodeError:
            url = url or raw.decode("utf-8", errors="ignore")
    # A URL hiding in the body of a "text" share is still a URL — treat it as one so the
    # full extraction pipeline runs instead of saving the raw link as a plain note.
    if input_type == "text" and (text or "").strip().startswith(("http://", "https://")):
        input_type, url = "url", text.strip()
    return IngestRequest(input_type=input_type, url=url, text=text, title=title,
                         content=content, source=source, note_hint=note_hint)


async def _create_job(db, user_id: str, body: IngestRequest) -> str:
    """Shared by both ingest endpoints: enforce caps, write the job doc, enqueue the worker."""
    await _enforce_cost_caps(db, user_id)
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.collection("jobs").document(job_id).set({
        "user_id": user_id,
        "input_type": body.input_type,    # "url" | "text" | "image" | "pdf" | "voice"
        "url": body.url or None,
        "text": body.text,                # typed-note body (input_type == "text")
        "title": body.title,              # user-supplied title (non-url inputs)
        "media_gcs_uri": body.media_gcs_uri,    # gs:// of the uploaded file
        "media_mime": body.media_mime,          # MIME for the worker's FileData part
        "media_cover_url": body.media_cover_url,  # public cover (images)
        "content": body.content,          # device-extracted text (PWA/shortcut), if any
        "source": body.source,            # "web" | "shortcut" | "pwa" | "ai_chat" | "upload"
        "note_hint": body.note_hint,      # user instructions for Gemini (from Clip AI chat)
        "status": "pending",
        "note_id": None,
        "error": None,
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    })
    enqueue_process_job(job_id)
    return job_id


@router.post("/ingest", response_model=JobStatus)
async def ingest(request: Request, user_id: str = Depends(require_user)):
    body = await _parse_ingest_request(request)

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

    job_id = await _create_job(get_db(), user_id, body)
    return JobStatus(job_id=job_id, status="pending")


@router.post("/ingest/upload", response_model=JobStatus)
async def ingest_upload(
    file: UploadFile = File(...),
    input_type: str = Form(...),
    title: str | None = Form(None),
    source: str = Form("upload"),
    note_hint: str | None = Form(None),
    user_id: str = Depends(require_user),
):
    """Binary capture path: a screenshot/image, PDF, or voice memo shared into the app.
    Uploads the bytes to GCS, then creates the same job shape the URL path does so the
    worker pipeline is identical from here on."""
    if input_type not in ("image", "pdf"):  # voice is the tracked fast-follow
        raise HTTPException(status_code=400, detail="Unsupported upload type.")
    if not uploads.bucket_for(input_type):
        raise HTTPException(status_code=503, detail="File uploads aren't configured on this server.")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File too large (max {settings.MAX_UPLOAD_MB} MB).")
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in settings.ALLOWED_UPLOAD_MIME.get(input_type, set()):
        raise HTTPException(status_code=415, detail=f"Unsupported {input_type} format ({mime or 'unknown'}).")

    gs_uri, cover_url = await uploads.store_upload(input_type, data, mime)
    body = IngestRequest(
        input_type=input_type, source=source, title=title, note_hint=note_hint,
        media_gcs_uri=gs_uri, media_mime=mime, media_cover_url=cover_url,
    )
    job_id = await _create_job(get_db(), user_id, body)
    return JobStatus(job_id=job_id, status="pending")
