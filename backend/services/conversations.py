"""Cross-session chat history for Ask AI.

Stored under `users/{uid}/conversations/{cid}` — each doc holds the conversation's title,
timestamps, and a bounded `messages` array ({role, text, citations?, artifact?, ts}). The
chat is otherwise stateless (the client resends recent turns each request); this layer lets a
user leave and resume. Reads/writes go through the backend (Firestore rules forbid client
writes to user docs), so the frontend uses the conversations router, not onSnapshot.
"""
import uuid
from datetime import datetime, timezone

from config import settings
from services.firebase import firestore_safe


def _conversations(db, user_id: str):
    return db.collection("users").document(user_id).collection("conversations")


def _derive_title(text: str) -> str:
    t = " ".join((text or "").split())
    return (t[:60] + "…") if len(t) > 60 else (t or "New chat")


async def persist_exchange(db, user_id: str, conversation_id: str | None,
                           user_text: str, assistant: dict) -> str:
    """Append one user turn + one assistant turn to a conversation, creating it if needed.
    Returns the conversation id (newly minted when `conversation_id` is None). Best-effort:
    callers treat a failure as non-fatal (the live answer was already delivered)."""
    cid = conversation_id or str(uuid.uuid4())
    ref = _conversations(db, user_id).document(cid)
    snap = await ref.get()
    existing = snap.to_dict() if snap.exists else None
    now = datetime.now(timezone.utc)

    messages = list((existing or {}).get("messages", []))
    messages.append({"role": "user", "text": user_text[:4000], "ts": now})
    messages.append({
        "role": "assistant",
        "text": (assistant.get("text") or "")[:8000],
        "citations": assistant.get("citations") or [],
        "artifact": assistant.get("artifact"),
        "ts": now,
    })
    messages = messages[-settings.MAX_CONVERSATION_MESSAGES:]

    doc = {
        "user_id": user_id,
        "title": (existing or {}).get("title") or _derive_title(user_text),
        "messages": firestore_safe(messages),
        "updated_at": now,
        "created_at": (existing or {}).get("created_at") or now,
    }
    await ref.set(doc, merge=True)

    if existing is None:
        await _enforce_conversation_cap(db, user_id)
    return cid


async def _enforce_conversation_cap(db, user_id: str) -> None:
    """Keep only the newest MAX_CONVERSATIONS_PER_USER; delete the overflow (oldest first).
    Runs only when a brand-new conversation is created, so it's an O(cap) sweep, rarely."""
    query = _conversations(db, user_id).order_by("updated_at", direction="DESCENDING")
    ids = [doc.id async for doc in query.stream()]
    for stale_id in ids[settings.MAX_CONVERSATIONS_PER_USER:]:
        await _conversations(db, user_id).document(stale_id).delete()


async def list_conversations(db, user_id: str, limit: int = 50) -> list[dict]:
    """Newest-first summaries (id, title, updated_at) — no message bodies."""
    query = (_conversations(db, user_id)
             .order_by("updated_at", direction="DESCENDING").limit(limit))
    out = []
    async for doc in query.stream():
        d = doc.to_dict() or {}
        out.append({"id": doc.id, "title": d.get("title", "Chat"),
                    "updated_at": d.get("updated_at")})
    return out


async def get_conversation(db, user_id: str, cid: str) -> dict | None:
    snap = await _conversations(db, user_id).document(cid).get()
    if not snap.exists:
        return None
    return {"id": cid, **(snap.to_dict() or {})}


async def delete_conversation(db, user_id: str, cid: str) -> None:
    await _conversations(db, user_id).document(cid).delete()
