"""Weekly digest email.

POST /digest/run  — OIDC-authed batch (Cloud Scheduler triggers it weekly). For each
opted-in user with at least one note in the last 7 days, renders and sends a digest via
Resend. Best-effort: one bad user never aborts the batch.

GET /digest/unsubscribe?u=&t=  — login-free unsubscribe (HMAC-signed so it can't be forged);
flips users/{uid}.digest_opt_in to False.
"""
import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone
from html import escape

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from config import settings
from services.email import send_email
from services.firebase import get_db, list_auth_users
from services.oidc import verify_oidc

router = APIRouter(tags=["digest"])
log = logging.getLogger("clipnote.digest")

DIGEST_LOOKBACK_DAYS = 7
DIGEST_MAX_NOTES = 12


def _unsub_secret() -> str:
    # Dedicated secret if set; otherwise fall back to the Resend key (also server-only).
    return settings.DIGEST_UNSUB_SECRET or settings.RESEND_API_KEY or "clipnote-dev-unsub"


def _unsub_token(uid: str) -> str:
    return hmac.new(_unsub_secret().encode(), uid.encode(), hashlib.sha256).hexdigest()[:32]


def _unsub_url(uid: str) -> str:
    return f"{settings.CLOUD_TASKS_WORKER_URL}/api/digest/unsubscribe?u={uid}&t={_unsub_token(uid)}"


def build_digest_html(display_name: str | None, notes: list[dict], unsub_url: str) -> str:
    """Render the weekly digest body. `notes` are dicts with id/title/ai_summary/content_type."""
    name = escape((display_name or "there").split(" ")[0])
    rows = []
    for n in notes:
        nid = escape(str(n.get("id", "")))
        title = escape(str(n.get("title") or "Untitled note"))
        summary = escape(str(n.get("ai_summary") or "")[:180])
        ctype = escape(str(n.get("content_type") or "note").replace("-", " "))
        link = f"{settings.APP_BASE_URL}/notes/{nid}"
        rows.append(
            f'<tr><td style="padding:14px 0;border-bottom:1px solid #eee;">'
            f'<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9a8f80;">{ctype}</div>'
            f'<a href="{link}" style="font-size:18px;color:#1a1a1a;text-decoration:none;font-weight:600;">{title}</a>'
            f'<div style="font-size:14px;color:#6b6256;margin-top:4px;line-height:1.5;">{summary}</div>'
            f"</td></tr>"
        )
    body = "".join(rows)
    return f"""\
<div style="max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;padding:24px;">
  <div style="font-size:22px;font-weight:700;">Clipnote</div>
  <p style="font-size:16px;color:#3a342c;margin-top:20px;">Hi {name}, here's what you saved this week — worth a re-read:</p>
  <table style="width:100%;border-collapse:collapse;">{body}</table>
  <a href="{settings.APP_BASE_URL}" style="display:inline-block;margin-top:24px;background:#1a1a1a;color:#fff;text-decoration:none;padding:11px 22px;border-radius:999px;font-size:14px;">Open Clipnote</a>
  <p style="font-size:12px;color:#9a8f80;margin-top:28px;">
    You're getting this because you have a Clipnote account.
    <a href="{unsub_url}" style="color:#9a8f80;">Unsubscribe from the weekly digest</a>.
  </p>
</div>"""


async def _recent_notes(db, uid: str, cutoff: datetime) -> list[dict]:
    q = (
        db.collection("notes")
        .where("user_id", "==", uid)
        .order_by("created_at", direction="DESCENDING")
        .limit(DIGEST_MAX_NOTES)
    )
    out = []
    async for doc in q.stream():
        d = doc.to_dict() or {}
        created = d.get("created_at")
        # created_at is a Firestore timestamp (datetime). Keep only the last-7-days window.
        if created is not None and created < cutoff:
            break  # ordered desc — everything after this is older too
        out.append({
            "id": doc.id,
            "title": d.get("title"),
            "ai_summary": d.get("ai_summary"),
            "content_type": d.get("content_type"),
        })
    return out


@router.post("/digest/run")
async def run_digest(request: Request):
    verify_oidc(request)
    db = get_db()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=DIGEST_LOOKBACK_DAYS)

    # Identity (email) from Auth; opt-in flag from the user doc.
    auth_users = await list_auth_users()
    user_docs: dict[str, dict] = {}
    async for doc in db.collection("users").stream():
        user_docs[doc.id] = doc.to_dict() or {}

    sent = skipped = 0
    for u in auth_users:
        uid, email = u["uid"], u.get("email")
        prof = user_docs.get(uid, {})
        if not email or prof.get("digest_opt_in") is not True:
            skipped += 1
            continue
        notes = await _recent_notes(db, uid, cutoff)
        if not notes:
            skipped += 1
            continue
        html = build_digest_html(u.get("display_name"), notes, _unsub_url(uid))
        subject = f"Your week in Clipnote — {len(notes)} note{'s' if len(notes) != 1 else ''} to revisit"
        if await send_email(email, subject, html):
            sent += 1
            await db.collection("users").document(uid).set({"last_digest_at": now}, merge=True)
        else:
            skipped += 1

    log.info("weekly digest run complete", extra={"sent": sent, "skipped": skipped})
    return {"sent": sent, "skipped": skipped}


@router.get("/digest/unsubscribe")
async def unsubscribe(u: str = "", t: str = ""):
    """Login-free, HMAC-verified unsubscribe link target from the digest email."""
    ok = bool(u) and hmac.compare_digest(t, _unsub_token(u))
    if ok:
        await get_db().collection("users").document(u).set({"digest_opt_in": False}, merge=True)
    msg = (
        "You've been unsubscribed from the weekly digest."
        if ok
        else "This unsubscribe link is invalid or expired."
    )
    return HTMLResponse(
        f"""<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:64px 24px;color:#1a1a1a;">
        <div style="font-size:22px;font-weight:700;">Clipnote</div>
        <p style="margin-top:16px;color:#6b6256;">{msg}</p>
        <a href="{settings.APP_BASE_URL}" style="color:#1a1a1a;">Back to Clipnote</a>
        </body></html>""",
        status_code=200 if ok else 400,
    )
