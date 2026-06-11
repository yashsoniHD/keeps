import asyncio
from datetime import datetime, timezone

import bcrypt
from fastapi import Header, HTTPException

from services.firebase import get_db, verify_firebase_token


# A locked token must be revoked + recreated from the web app. The lock check runs
# BEFORE the bcrypt compare so brute-force attempts on a locked token cost no CPU.
MAX_FAILED_PAT_ATTEMPTS = 10


async def _verify_pat(token: str) -> str:
    """Validates a cn_<id>.<secret> Personal Access Token; returns the owner's uid
    and bumps last_used_at. bcrypt check runs off the event loop."""
    try:
        token_id, secret = token.removeprefix("cn_").split(".", 1)
    except ValueError:
        raise HTTPException(401, "Invalid token")
    db = get_db()
    snap = await db.collection("shortcut_tokens").document(token_id).get()
    if not snap.exists:
        raise HTTPException(401, "Invalid token")
    data = snap.to_dict()
    failed = data.get("failed_attempts", 0)
    if failed >= MAX_FAILED_PAT_ATTEMPTS:
        raise HTTPException(401, "Token locked after repeated failures — create a new one in Settings")
    ok = await asyncio.to_thread(
        bcrypt.checkpw, secret.encode(), data.get("token_hash", "").encode()
    )
    if not ok:
        await snap.reference.update({"failed_attempts": failed + 1})
        raise HTTPException(401, "Invalid token")
    update = {"last_used_at": datetime.now(timezone.utc)}
    if failed:
        update["failed_attempts"] = 0
    await snap.reference.update(update)
    return data["user_id"]


async def require_user(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: accepts a Firebase ID token (web app) or a cn_ PAT
    (iOS shortcut); returns the authenticated uid or raises 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = authorization.removeprefix("Bearer ")
    if token.startswith("cn_"):
        return await _verify_pat(token)
    try:
        return await verify_firebase_token(token)
    except Exception:
        raise HTTPException(401, "Invalid token")


async def require_firebase_user(authorization: str | None = Header(default=None)) -> str:
    """Stricter dependency for token management: a PAT must not mint/revoke PATs."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = authorization.removeprefix("Bearer ")
    if token.startswith("cn_"):
        raise HTTPException(403, "Sign in on the web to manage tokens")
    try:
        return await verify_firebase_token(token)
    except Exception:
        raise HTTPException(401, "Invalid token")
