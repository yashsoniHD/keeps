import asyncio
import logging
import re
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import auth
from google.cloud.firestore_v1 import AsyncClient, ArrayRemove, ArrayUnion, Increment

from config import settings
from services.usage_meter import UsageMeter

log = logging.getLogger("clipnote.firebase")

_app = None
_db: AsyncClient | None = None


def get_firebase_app():
    global _app
    if _app is None:
        # On Cloud Run / locally with ADC: Application Default Credentials.
        _app = firebase_admin.initialize_app(options={"projectId": settings.GOOGLE_CLOUD_PROJECT})
    return _app


def get_db() -> AsyncClient:
    """Singleton Firestore async client (never create a new client per request)."""
    global _db
    if _db is None:
        get_firebase_app()
        _db = AsyncClient(project=settings.GOOGLE_CLOUD_PROJECT)
    return _db


async def verify_firebase_token(token: str) -> str:
    """Verifies a Firebase ID token and returns the uid. The SDK call is blocking —
    run it off the event loop."""
    get_firebase_app()
    decoded = await asyncio.to_thread(auth.verify_id_token, token)
    return decoded["uid"]


async def verify_firebase_token_claims(token: str) -> dict:
    """Like verify_firebase_token but returns the full decoded claims (uid, email,
    email_verified, name, …) — used by admin gating, which checks the email."""
    get_firebase_app()
    return await asyncio.to_thread(auth.verify_id_token, token)


async def get_user_categories(uid: str) -> list[str]:
    """The user's known content_type slugs from users/{uid}.categories —
    one doc read, never a notes-collection scan."""
    snap = await get_db().collection("users").document(uid).get()
    if not snap.exists:
        return []
    return sorted(snap.to_dict().get("categories", []))


def firestore_safe(value):
    """Makes an arbitrary Gemini-built structure storable in Firestore.

    Firestore rejects arrays nested directly inside arrays ("invalid nested
    entity") — and the composer prompt's table block is exactly that:
    rows: [[cell, cell], …]. The model's output shape stays natural; inner
    arrays get wrapped as {"cells": [...]} at the write boundary, and the
    GenericNote template renders both shapes. Applies recursively so any
    AI-invented nesting can't kill the note write.
    """
    if isinstance(value, dict):
        return {str(k): firestore_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [
            {"cells": firestore_safe(list(v))} if isinstance(v, (list, tuple)) else firestore_safe(v)
            for v in value
        ]
    return value


async def add_user_category(uid: str, slug: str) -> None:
    """Adds a content_type slug to users/{uid}.categories (idempotent via ArrayUnion)."""
    await get_db().collection("users").document(uid).set(
        {"categories": ArrayUnion([slug])}, merge=True
    )


async def add_user_source(uid: str, domain: str) -> None:
    """Adds a source domain to users/{uid}.sources (idempotent via ArrayUnion) so the
    feed's source filter reflects the whole corpus, not just the loaded/filtered window."""
    if not domain:
        return
    await get_db().collection("users").document(uid).set(
        {"sources": ArrayUnion([domain])}, merge=True
    )


async def remove_user_category(uid: str, slug: str) -> None:
    """Drops a content_type slug from users/{uid}.categories (idempotent via ArrayRemove)."""
    await get_db().collection("users").document(uid).set(
        {"categories": ArrayRemove([slug])}, merge=True
    )


async def prune_category_if_empty(uid: str, slug: str) -> bool:
    """Auto-remove a category once its last note is gone. Called after a note is deleted or
    re-categorised; a no-op if any note of this type remains (cheap — reads at most one doc).
    Placeholder categories the user added but never filled never trigger this (no note ever
    leaves them), so the manual "Add a category" flow is preserved. Returns True if pruned."""
    if not slug:
        return False
    query = (
        get_db().collection("notes")
        .where("user_id", "==", uid)
        .where("content_type", "==", slug)
        .limit(1)
    )
    async for _ in query.stream():
        return False  # still has at least one note — keep it
    await remove_user_category(uid, slug)
    return True


async def count_notes_by_type(uid: str) -> dict[str, int]:
    """Tally of the user's notes by content_type, in one streamed pass — used by the
    Categories management UI (cheaper than one aggregation query per category)."""
    counts: dict[str, int] = {}
    query = get_db().collection("notes").where("user_id", "==", uid).select(["content_type"])
    async for doc in query.stream():
        ct = (doc.to_dict() or {}).get("content_type")
        if ct:
            counts[ct] = counts.get(ct, 0) + 1
    return counts


async def retag_notes(uid: str, old_slug: str, new_slug: str) -> int:
    """Re-tag every note the user owns from one content_type to another (a category
    rename or delete-with-fallback). Batched at ≤450 writes (Firestore's 500-op cap).
    Returns the number of notes re-tagged. No-op-safe when old_slug == new_slug."""
    if old_slug == new_slug:
        return 0
    db = get_db()
    query = db.collection("notes").where("user_id", "==", uid).where("content_type", "==", old_slug)
    now = datetime.now(timezone.utc)
    batch = db.batch()
    pending = 0
    total = 0
    async for doc in query.stream():
        batch.update(doc.reference, {"content_type": new_slug, "updated_at": now})
        pending += 1
        total += 1
        if pending >= 450:
            await batch.commit()
            batch = db.batch()
            pending = 0
    if pending:
        await batch.commit()
    return total


async def ensure_user_doc(uid: str, *, display_name: str | None = None,
                          email: str | None = None, photo_url: str | None = None) -> None:
    """Creates/refreshes the users/{uid} profile doc (called on first ingest)."""
    doc = {k: v for k, v in {
        "display_name": display_name, "email": email, "photo_url": photo_url,
    }.items() if v is not None}
    if doc:
        await get_db().collection("users").document(uid).set(doc, merge=True)


async def touch_user_activity(uid: str, *, first_note: bool = False) -> None:
    """Best-effort activation/retention milestones on users/{uid}:
      - last_active_at: overwritten on every metered action (ingest/ask) → powers
        'active in the last N days' and the retention cohorts in the admin dashboard.
      - first_note_at: written once, when the user's first note lands → anchors
        time-to-activate and the D0 cohort. Only set when absent so it stays immutable.
    Signup time comes free from Firebase Auth (creationTime), so it isn't stored here.
    A failure here must never fail the underlying capture/ask — all errors are swallowed."""
    now = datetime.now(timezone.utc)
    ref = get_db().collection("users").document(uid)
    try:
        if first_note:
            snap = await ref.get()
            updates = {"last_active_at": now}
            if not (snap.to_dict() or {}).get("first_note_at"):
                updates["first_note_at"] = now
            await ref.set(updates, merge=True)
        else:
            await ref.set({"last_active_at": now}, merge=True)
    except Exception:
        log.warning("touch_user_activity failed for uid=%s", uid, exc_info=True)


async def flush_usage(user_id: str, meter: UsageMeter) -> None:
    """Persist a request's AI spend into the global daily counter (system/usage-{date}) for
    tracking only (tok_* fields). The kill switch reads `note_count`, not spend. No per-user
    counters. Best-effort: never fails the capture."""
    if meter is None or meter.calls == 0:
        return
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    try:
        await get_db().collection("system").document(f"usage-{today}").set(
            {"date": today, "tok_ai_calls": Increment(meter.calls),
             "tok_cost_usd": Increment(meter.cost_usd),
             # calls per model that answered (free vs paid fallback); "/" and "." can't be
             # in field names.
             "models": {re.sub(r"[/.]", "_", m): Increment(n)
                        for m, n in getattr(meter, "models", {}).items()}}, merge=True)
    except Exception as e:
        log.warning("usage flush failed for %s: %s: %s", user_id, type(e).__name__, e)


async def reserve_apify_slot() -> bool:
    """Transactionally claim one paid-scrape (Apify) slot for today against the global
    daily cap. Returns True if claimed (caller may call Apify), False if the cap is hit
    (caller falls through to the free og-caption path). `get_db()` sits outside the try, so the caller must catch
    (a capped or failed reservation must still produce a note). Global-only: Apify is the last resort before caption-only,
    so the ceiling guards the budget rather than rationing per user."""
    from google.cloud import firestore as fs

    db = get_db()
    today = datetime.now(timezone.utc).strftime("%Y%m%d")

    @fs.async_transactional
    async def _claim(tx) -> bool:
        global_ref = db.collection("system").document(f"usage-{today}")
        global_snap = await global_ref.get(transaction=tx)
        global_n = (global_snap.to_dict() or {}).get("apify_count", 0)
        if global_n >= settings.APIFY_DAILY_GLOBAL_CAP:
            return False
        tx.set(global_ref, {"date": today, "apify_count": global_n + 1}, merge=True)
        return True

    try:
        return await _claim(db.transaction())
    except Exception as e:  # noqa: BLE001 — capping is best-effort; never fail a capture.
        log.warning("apify slot reservation failed: %s: %s", type(e).__name__, e)
        return False


