import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import firestore as fs

from config import settings
from models.note import IngestRequest, JobStatus
from services.auth_dep import require_user
from services.cloud_tasks import enqueue_process_job
from services.firebase import get_db

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


@router.post("/ingest", response_model=JobStatus)
async def ingest(body: IngestRequest, user_id: str = Depends(require_user)):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL")

    db = get_db()
    await _enforce_cost_caps(db, user_id)

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await db.collection("jobs").document(job_id).set({
        "user_id": user_id,
        "url": body.url,
        "content": body.content,   # device-extracted text (PWA/shortcut), if any
        "source": body.source,     # "web" | "shortcut" | "pwa"
        "status": "pending",
        "note_id": None,
        "error": None,
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    })

    enqueue_process_job(job_id)
    return JobStatus(job_id=job_id, status="pending")
