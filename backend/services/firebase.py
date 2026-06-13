import asyncio
import logging
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


def _split_by_tier(meter: UsageMeter) -> tuple[int, int, int, int]:
    """Collapse per-model token totals into (main_in, main_out, lite_in, lite_out).
    Anything that isn't the lite model is billed at main rates (the main model also
    serves the search-grounded salvage path)."""
    main_in = main_out = lite_in = lite_out = 0
    for model, (tin, tout) in meter.by_model.items():
        if model == settings.GEMINI_LITE_MODEL:
            lite_in += tin
            lite_out += tout
        else:
            main_in += tin
            main_out += tout
    return main_in, main_out, lite_in, lite_out


async def flush_usage(user_id: str, meter: UsageMeter) -> None:
    """Persist a request's Gemini token usage. Two writes:
      - users/{uid}: lifetime counters (cheap single-doc read powers the dashboard)
      - system/usage-{date}: global daily token totals (powers 'cost today')
    Per-tier so cost can be computed from the two models' different prices. Best-effort:
    a flush failure must never fail the underlying capture/ask."""
    if meter is None or meter.calls == 0:
        return
    main_in, main_out, lite_in, lite_out = _split_by_tier(meter)
    fields = {
        "tokens_in_main": Increment(main_in),
        "tokens_out_main": Increment(main_out),
        "tokens_in_lite": Increment(lite_in),
        "tokens_out_lite": Increment(lite_out),
        "ai_calls": Increment(meter.calls),
    }
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    db = get_db()
    try:
        await db.collection("users").document(user_id).set(
            {f"lifetime_{k}": v for k, v in fields.items()}, merge=True
        )
        await db.collection("system").document(f"usage-{today}").set(
            {"date": today, **{f"tok_{k}": v for k, v in fields.items()}}, merge=True
        )
    except Exception as e:
        log.warning("usage flush failed for %s: %s: %s", user_id, type(e).__name__, e)


async def reserve_image_slot(user_id: str) -> bool:
    """Transactionally claim one AI-cover-generation slot for today, enforcing the
    per-user and global daily caps. Returns True if claimed (caller may generate), False
    if a cap is hit (caller keeps the gradient fallback). Never raises — a capped note
    must still be created. The `image_count` it bumps powers both the caps and the admin
    'images today' figure."""
    from google.cloud import firestore as fs

    db = get_db()
    today = datetime.now(timezone.utc).strftime("%Y%m%d")

    @fs.async_transactional
    async def _claim(tx) -> bool:
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("image_count", 0)
        global_n = (global_snap.to_dict() or {}).get("image_count", 0)
        if user_n >= settings.MAX_IMAGES_PER_USER_PER_DAY:
            return False
        if global_n >= settings.DAILY_GLOBAL_IMAGE_CAP:
            return False
        tx.set(user_ref, {"user_id": user_id, "date": today, "image_count": user_n + 1}, merge=True)
        tx.set(global_ref, {"date": today, "image_count": global_n + 1}, merge=True)
        return True

    try:
        return await _claim(db.transaction())
    except Exception as e:  # noqa: BLE001 — capping is best-effort; never fail a note.
        log.warning("image slot reservation failed for %s: %s: %s", user_id, type(e).__name__, e)
        return False


async def record_image_generated(user_id: str) -> None:
    """Bump the per-user lifetime AI-cover count (powers the admin per-user cost column).
    Best-effort — a metering write must never fail the underlying capture."""
    try:
        await get_db().collection("users").document(user_id).set(
            {"lifetime_images": Increment(1)}, merge=True
        )
    except Exception as e:  # noqa: BLE001
        log.warning("image meter write failed for %s: %s: %s", user_id, type(e).__name__, e)


async def list_auth_users() -> list[dict]:
    """Enumerate all Firebase Auth users — the source of truth for identity (email,
    name, signup time, last sign-in), which the users/{uid} Firestore docs don't carry.
    Paginates 1000/page; blocking SDK so it runs off the event loop. Timestamps are
    epoch-millis ints (JSON-safe; the frontend formats them)."""
    get_firebase_app()

    def _list() -> list[dict]:
        out: list[dict] = []
        page = auth.list_users()
        while page:
            for u in page.users:
                meta = u.user_metadata
                out.append({
                    "uid": u.uid,
                    "email": u.email,
                    "display_name": u.display_name,
                    "photo_url": u.photo_url,
                    "created_at": getattr(meta, "creation_timestamp", None),
                    "last_sign_in": getattr(meta, "last_sign_in_timestamp", None),
                })
            page = page.get_next_page()
        return out

    return await asyncio.to_thread(_list)
