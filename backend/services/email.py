"""Transactional email via Resend's REST API.

Best-effort by design: any failure returns False (a digest batch must never crash on one
bad address), and the whole thing is a no-op until RESEND_API_KEY + DIGEST_FROM_EMAIL are
set — so the digest endpoint is safe to deploy before the provider is configured.
"""
import logging

import httpx

from config import settings

log = logging.getLogger("clipnote.email")


def email_configured() -> bool:
    return bool(settings.RESEND_API_KEY and settings.DIGEST_FROM_EMAIL)


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send one HTML email. Returns True on success, False on any failure / when unconfigured."""
    if not email_configured():
        log.warning("email not configured (RESEND_API_KEY / DIGEST_FROM_EMAIL) — skipping send")
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json={
                    "from": settings.DIGEST_FROM_EMAIL,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
            if r.status_code >= 300:
                log.warning("resend send failed: %s %s", r.status_code, r.text[:300])
                return False
            return True
    except Exception:
        log.warning("resend send error", exc_info=True)
        return False
