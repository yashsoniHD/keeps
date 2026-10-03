"""Shared-secret auth for internal worker endpoints (/api/process*).

Callers are this deployment itself (X-Worker-Secret) and, for the sweep route only,
Vercel cron (Authorization: Bearer $CRON_SECRET).
"""
import hmac

from fastapi import HTTPException

from config import settings


def _eq(supplied: str, expected: str) -> bool:
    # bytes: compare_digest raises TypeError on non-ASCII str, and that must be a 403.
    return bool(expected) and hmac.compare_digest(supplied.encode(), expected.encode())


def verify_worker_secret(request, allow_cron: bool = False) -> None:
    """Raise 403 unless the request carries the worker secret (or, with allow_cron, the cron
    bearer). Fails closed when the configured secret is empty."""
    if _eq(request.headers.get("x-worker-secret", ""), settings.WORKER_SECRET):
        return
    if allow_cron:
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer ") and _eq(auth.removeprefix("Bearer "), settings.CRON_SECRET):
            return
    raise HTTPException(403, "Forbidden")
