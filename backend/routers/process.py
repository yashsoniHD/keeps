"""Cloud Tasks worker: the full URL → note pipeline.

Auth: Cloud Tasks OIDC token (signature + audience + SA email) — no shared secret.
Idempotent: a retry of a completed job is a no-op (no double AI spend).
Permanent failures return 200 with status=failed so Cloud Tasks does not retry them.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.cloud import firestore as fs
from google.oauth2 import id_token

from config import settings
from services import sources
from services.firebase import add_user_category, firestore_safe, get_db, get_user_categories
from services.gemini import gemini_service

router = APIRouter(tags=["process"])
log = logging.getLogger("clipnote.process")


def _verify_oidc(request: Request) -> None:
    """Validates the Cloud Tasks OIDC token: signature, audience (worker URL), SA email."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(403, "Forbidden")
    try:
        claims = id_token.verify_oauth2_token(
            auth_header.removeprefix("Bearer "),
            google_requests.Request(),
            audience=settings.CLOUD_TASKS_WORKER_URL,
        )
    except Exception:
        raise HTTPException(403, "Forbidden")
    if claims.get("email") != settings.CLOUD_TASKS_SA_EMAIL or not claims.get("email_verified"):
        raise HTTPException(403, "Forbidden")


@router.post("/process/{job_id}")
async def process_job(job_id: str, request: Request):
    _verify_oidc(request)

    db = get_db()
    job_ref = db.collection("jobs").document(job_id)
    job_snap = await job_ref.get()
    if not job_snap.exists:
        return {"status": "missing"}   # permanent — don't make Cloud Tasks retry

    job = job_snap.to_dict()
    if job.get("status") == "completed":
        return {"status": "completed", "note_id": job.get("note_id")}

    user_id: str = job["user_id"]
    url: str = job["url"]
    device_content: str | None = job.get("content")
    source: str = job.get("source", "web")
    now = datetime.now(timezone.utc)
    await job_ref.update({"status": "processing", "attempt_count": fs.Increment(1), "updated_at": now})

    try:
        # 1. Acquire content via the source-aware resolver (or trust device-extracted text,
        #    which already bypassed any paywall/login on the user's phone).
        if device_content:
            from models.note import ContentBundle
            bundle = ContentBundle(kind="text", text=device_content[:30000],
                                   metadata={"title": url, "platform": source},
                                   strategy="device_content")
        else:
            bundle = await sources.acquire(url)

        # 2. Categorize against this user's own categories.
        existing = await get_user_categories(user_id)
        content_type = await gemini_service.assign_category(url, bundle, existing)

        # 3. Type-focused extraction (structured data only — never HTML).
        extracted = await gemini_service.extract_async(url, bundle, content_type)

        if not extracted.data or len(str(extracted.data)) < 40:
            raise ValueError("Extraction produced empty or suspiciously short data")

        cover_image_url = bundle.images[0] if bundle.images else None
        source_domain = url.split("/")[2].replace("www.", "") if "://" in url else url

        note_id = str(uuid.uuid4())
        await db.collection("notes").document(note_id).set({
            "user_id": user_id,
            "content_type": extracted.content_type,
            "title": extracted.title,
            "ai_summary": extracted.ai_summary,
            "source_url": url,
            "source_domain": source_domain,
            "source": source,
            "cover_image_url": cover_image_url,
            "data": firestore_safe(extracted.data),
            "acquisition": bundle.strategy,
            "created_at": now,
            "updated_at": now,
        })
        await add_user_category(user_id, extracted.content_type)
        await job_ref.update({"status": "completed", "note_id": note_id,
                              "updated_at": datetime.now(timezone.utc)})
        log.info("note created (%s via %s)", extracted.content_type, bundle.strategy,
                 extra={"job_id": job_id, "user_id": user_id, "url": url, "strategy": bundle.strategy})
        return {"status": "completed", "note_id": note_id}

    except Exception as e:
        # Mark failed and return 200: retrying would just re-spend on the same failing input.
        log.error("process job failed: %s: %s", type(e).__name__, e,
                  extra={"job_id": job_id, "user_id": user_id, "url": url}, exc_info=True)
        await job_ref.update({"status": "failed", "error": f"{type(e).__name__}: {e}"[:500],
                              "updated_at": datetime.now(timezone.utc)})
        return {"status": "failed", "error": str(e)[:200]}
