"""Cloud Tasks worker: the full URL → note pipeline.

Auth: Cloud Tasks OIDC token (signature + audience + SA email) — no shared secret.
Idempotent: a retry of a completed job is a no-op (no double AI spend).

Failure ladder (a capture must always produce a note):
  - BlockedURLError (SSRF guard) → failed, no note, no retry. Permanent by design.
  - Transient (Gemini 5xx/429, network timeouts) below MAX_TRANSIENT_ATTEMPTS →
    re-raise as 500 so Cloud Tasks retries with its configured backoff.
  - Everything else (and transient at the attempt cap) → salvage: a minimal
    "bookmark" note from whatever metadata is reachable. Only if even the
    salvage Firestore write fails does the job end up failed.
"""
import logging
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.cloud import firestore as fs
from google.cloud.firestore_v1.vector import Vector
from google.genai import errors as genai_errors
from google.oauth2 import id_token

from config import settings
from models.note import ContentBundle
from services import sources
from services.covers import persist_cover
from services.embeddings import embedding_service
from services.firebase import (
    add_user_category,
    firestore_safe,
    flush_usage,
    get_db,
    get_user_categories,
    record_image_generated,
    reserve_image_slot,
)
from services.gemini import gemini_service
from services.imagen import generate_cover
from services.net_guard import BlockedURLError, guarded_async_client
from services.usage_meter import start_metering

router = APIRouter(tags=["process"])
log = logging.getLogger("clipnote.process")


async def _note_embedding(title: str, ai_summary: str = "") -> Vector | None:
    """Embed a note's text for semantic search. Non-fatal: on any failure the note is
    still written (search just misses it until a backfill re-embeds it)."""
    text = "\n".join(p for p in (title, ai_summary) if p).strip()
    if not text:
        return None
    try:
        vec = await embedding_service.embed_document(text)
        return Vector(vec) if vec else None
    except Exception as e:
        log.warning("note embedding failed, writing note without it: %s: %s",
                    type(e).__name__, e)
        return None

# A transient failure below this many attempts re-raises as 500 (Cloud Tasks retries,
# max-backoff 600s); at the cap it salvages instead — the user gets a note either way.
MAX_TRANSIENT_ATTEMPTS = 3


def _is_transient(e: Exception) -> bool:
    """Failures with a real chance of succeeding on a Cloud Tasks retry."""
    if isinstance(e, (httpx.TimeoutException, httpx.TransportError)):
        return True
    if isinstance(e, genai_errors.APIError):
        return e.code == 429 or e.code >= 500
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


async def _salvage_note(db, *, user_id: str, url: str, source: str,
                        bundle: ContentBundle | None, now: datetime) -> str:
    """Writes a minimal bookmark note so the capture is never lost.

    Title/cover tiers: acquired bundle metadata → lightweight og: fetch → bare domain.
    Enrichment is best-effort; only the Firestore write may fail upward.
    """
    domain = _domain_of(url)
    title: str | None = None
    cover: str | None = None
    try:
        if bundle is not None:
            meta_title = (bundle.metadata or {}).get("title")
            if meta_title and str(meta_title) not in (domain, url, "Untitled"):
                title = str(meta_title)
            cover = bundle.images[0] if bundle.images else None
        if not title:
            preview = await _link_preview(url)
            title = preview.get("title") or None
            cover = cover or preview.get("image")
    except Exception as e:
        log.warning("salvage enrichment failed, writing URL-only note: %s: %s",
                    type(e).__name__, e, extra={"url": url, "user_id": user_id})

    note_id = str(uuid.uuid4())
    embedding = await _note_embedding(title or domain)
    note_doc = {
        "user_id": user_id,
        "content_type": "bookmark",
        "title": title or domain,
        "ai_summary": "Saved as a bookmark — this link couldn't be fully processed. "
                      "Open the source to read it, or retry from the note.",
        "source_url": url,
        "source_domain": domain,
        "source": source,
        "cover_image_url": cover,
        "data": {"facts": [{"label": "Source", "value": domain}], "sections": []},
        "acquisition": "salvage",
        "is_fallback": True,
        "created_at": now,
        "updated_at": now,
    }
    if embedding is not None:
        note_doc["embedding"] = embedding
    await db.collection("notes").document(note_id).set(note_doc)
    return note_id


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
    # This run's attempt number — read before the Increment so the ladder below can
    # compare against MAX_TRANSIENT_ATTEMPTS without a second Firestore read.
    attempt = (job.get("attempt_count") or 0) + 1
    await job_ref.update({"status": "processing", "attempt_count": fs.Increment(1), "updated_at": now})

    # Meter Gemini token spend for this job; flushed once below regardless of outcome
    # (a failed/salvaged job still incurred AI cost that must be attributed).
    meter = start_metering()
    bundle: ContentBundle | None = None
    try:
        # 1. Acquire content via the source-aware resolver (or trust device-extracted text,
        #    which already bypassed any paywall/login on the user's phone).
        if device_content:
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
        # Re-host hot-linked source thumbnails (which expire) in our public covers bucket.
        # Skip frames we already extracted (those are covers-bucket URLs).
        if cover_image_url and settings.COVERS_BUCKET not in cover_image_url:
            cover_image_url = await persist_cover(cover_image_url) or cover_image_url
        # Last resort: generate a cover with Imagen (gated, capped). Only when the note
        # would otherwise be coverless — real source imagery always wins. A miss (off,
        # capped, RAI-filtered, error) leaves it None → frontend renders the gradient hero.
        if not cover_image_url and settings.ENABLE_IMAGEN and extracted.cover_image_prompt:
            if await reserve_image_slot(user_id):
                cover_image_url = await generate_cover(
                    extracted.cover_image_prompt, extracted.content_type
                )
                if cover_image_url:
                    await record_image_generated(user_id)
        source_domain = url.split("/")[2].replace("www.", "") if "://" in url else url

        note_id = str(uuid.uuid4())
        embedding = await _note_embedding(extracted.title, extracted.ai_summary)
        note_doc = {
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
        }
        if embedding is not None:
            note_doc["embedding"] = embedding
        await db.collection("notes").document(note_id).set(note_doc)
        await add_user_category(user_id, extracted.content_type)
        await job_ref.update({"status": "completed", "note_id": note_id,
                              "updated_at": datetime.now(timezone.utc)})
        log.info("note created (%s via %s)", extracted.content_type, bundle.strategy,
                 extra={"job_id": job_id, "user_id": user_id, "url": url, "strategy": bundle.strategy})
        return {"status": "completed", "note_id": note_id}

    except BlockedURLError as e:
        # SSRF guard or unsupported scheme — permanent and deliberate: no note, no retry.
        log.warning("blocked URL, failing without a note: %s", e,
                    extra={"job_id": job_id, "user_id": user_id, "url": url})
        await job_ref.update({"status": "failed", "error": f"BlockedURL: {e}"[:500],
                              "updated_at": datetime.now(timezone.utc)})
        return {"status": "failed", "error": str(e)[:200]}

    except Exception as e:
        if _is_transient(e) and attempt < MAX_TRANSIENT_ATTEMPTS:
            # Let Cloud Tasks retry with its configured backoff. Status returns to
            # "pending" so the feed keeps showing the in-flight card, not a failure.
            log.warning("transient failure (attempt %d/%d), re-raising for retry: %s: %s",
                        attempt, MAX_TRANSIENT_ATTEMPTS, type(e).__name__, e,
                        extra={"job_id": job_id, "user_id": user_id, "url": url})
            await job_ref.update({"status": "pending",
                                  "error": f"transient: {type(e).__name__}: {e}"[:500],
                                  "updated_at": datetime.now(timezone.utc)})
            raise HTTPException(500, "Transient failure — Cloud Tasks will retry")

        # Permanent extraction failure (or transient at the cap) → salvage a bookmark
        # note. The capture is preserved even when the AI pipeline can't deliver.
        log.error("process job failed, salvaging bookmark note: %s: %s", type(e).__name__, e,
                  extra={"job_id": job_id, "user_id": user_id, "url": url}, exc_info=True)
        try:
            note_id = await _salvage_note(db, user_id=user_id, url=url, source=source,
                                          bundle=bundle, now=datetime.now(timezone.utc))
            try:
                await add_user_category(user_id, "bookmark")
            except Exception:
                pass  # category chip is cosmetic — never fail the salvage over it
            await job_ref.update({"status": "completed", "note_id": note_id,
                                  "error": f"salvaged: {type(e).__name__}: {e}"[:500],
                                  "updated_at": datetime.now(timezone.utc)})
            return {"status": "completed", "note_id": note_id, "salvaged": True}
        except Exception as salvage_exc:
            # Even the URL-only Firestore write failed — the one path left is "failed".
            log.error("salvage write failed: %s: %s", type(salvage_exc).__name__, salvage_exc,
                      extra={"job_id": job_id, "user_id": user_id, "url": url}, exc_info=True)
            await job_ref.update({"status": "failed", "error": f"{type(e).__name__}: {e}"[:500],
                                  "updated_at": datetime.now(timezone.utc)})
            return {"status": "failed", "error": str(e)[:200]}

    finally:
        # Attribute token spend even when the job re-raised for a Cloud Tasks retry.
        await flush_usage(user_id, meter)
