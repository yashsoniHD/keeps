"""Personal Access Tokens for the iOS Shortcut (Phase 2, Track B).

Token format: cn_<doc_id>.<secret> — the doc id makes lookup O(1); only the bcrypt hash
of the secret is stored. The raw token is returned exactly once at creation.

Token management requires a Firebase session (a PAT cannot mint or revoke PATs).
"""
import secrets
import uuid
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services.auth_dep import require_firebase_user
from services.firebase import get_db

router = APIRouter(tags=["tokens"])


class TokenCreateRequest(BaseModel):
    label: str = "iPhone"


@router.post("/tokens")
async def create_token(body: TokenCreateRequest, user_id: str = Depends(require_firebase_user)):
    db = get_db()
    token_id = uuid.uuid4().hex[:12]
    secret = secrets.token_urlsafe(24)
    token_hash = bcrypt.hashpw(secret.encode(), bcrypt.gensalt()).decode()
    now = datetime.now(timezone.utc)
    await db.collection("shortcut_tokens").document(token_id).set({
        "user_id": user_id,
        "token_hash": token_hash,
        "label": body.label[:40] or "iPhone",
        "created_at": now,
        "last_used_at": None,
    })
    return {"token": f"cn_{token_id}.{secret}", "id": token_id, "label": body.label[:40]}


@router.get("/tokens")
async def list_tokens(user_id: str = Depends(require_firebase_user)):
    db = get_db()
    query = db.collection("shortcut_tokens").where("user_id", "==", user_id)
    out = []
    async for doc in query.stream():
        d = doc.to_dict()
        out.append({
            "id": doc.id,
            "label": d.get("label"),
            "created_at": d.get("created_at"),
            "last_used_at": d.get("last_used_at"),
        })
    return out


@router.delete("/tokens/{token_id}")
async def revoke_token(token_id: str, user_id: str = Depends(require_firebase_user)):
    db = get_db()
    ref = db.collection("shortcut_tokens").document(token_id)
    snap = await ref.get()
    if not snap.exists or snap.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Token not found")
    await ref.delete()
    return {"status": "revoked"}
