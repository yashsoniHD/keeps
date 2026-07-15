import asyncio
import logging
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import auth
from google.cloud.firestore_v1 import AsyncClient, ArrayRemove, ArrayUnion, Increment
from google.cloud.firestore_v1.transforms import DELETE_FIELD

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


async def get_user_collections(uid: str) -> list[dict]:
    """The user's smart buckets from collections/{cid} — [{id, name, description, topic_embedding,
    pinned_note_ids, excluded_note_ids, match_threshold}] — fed to the classifier (name/description
    only) so it can file a new note into one at ingest, and to the rescore/matcher path (the extra
    fields) so a note's membership can be re-derived by cosine similarity. Extra keys are additive —
    callers that only read id/name/description (e.g. gemini.classify) are unaffected. One indexed
    query, not a note scan."""
    query = get_db().collection("collections").where("user_id", "==", uid)
    out: list[dict] = []
    async for doc in query.stream():
        d = doc.to_dict() or {}
        # topic_embedding is stored as a Firestore Vector; normalize to a plain list of floats
        # (same convention as reading note embeddings elsewhere) so callers can do plain-Python math.
        topic_embedding = d.get("topic_embedding")
        out.append({
            "id": doc.id,
            "name": d.get("name", ""),
            "description": d.get("description") or "",
            "topic_embedding": list(topic_embedding) if topic_embedding is not None else None,
            "pinned_note_ids": d.get("pinned_note_ids") or [],
            "excluded_note_ids": d.get("excluded_note_ids") or [],
            "match_threshold": d.get("match_threshold"),
        })
    return out


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


async def get_category_meta(uid: str) -> dict[str, dict]:
    """The user's per-category icon/colour overrides from users/{uid}.category_meta —
    a map of slug -> {icon?, palette?}. One doc read."""
    snap = await get_db().collection("users").document(uid).get()
    if not snap.exists:
        return {}
    return snap.to_dict().get("category_meta", {}) or {}


async def set_category_meta(
    uid: str, slug: str, icon: str | None = None, palette: int | None = None
) -> None:
    """Pin an icon and/or palette for a category. Only the provided fields are written
    (deep-merge), so other categories' overrides — and the slug's other field — are left
    intact. Whichever of icon/palette is None is simply not touched."""
    entry: dict = {}
    if icon is not None:
        entry["icon"] = icon
    if palette is not None:
        entry["palette"] = palette
    if not entry:
        return
    await get_db().collection("users").document(uid).set(
        {"category_meta": {slug: entry}}, merge=True
    )


async def move_category_meta(uid: str, old_slug: str, new_slug: str) -> None:
    """Carry a category's icon/colour override from one slug to another on rename, then
    drop the old entry. No-op when the slug is unchanged."""
    if old_slug == new_slug:
        return
    meta = await get_category_meta(uid)
    entry = meta.get(old_slug)
    updates: dict = {f"category_meta.{old_slug}": DELETE_FIELD}
    if entry:
        updates[f"category_meta.{new_slug}"] = entry
    try:
        await get_db().collection("users").document(uid).update(updates)
    except Exception as e:  # noqa: BLE001 — best-effort, but a real write failure must be visible
        log.warning("category meta move %s→%s failed for %s: %s: %s",
                    old_slug, new_slug, uid, type(e).__name__, e)


async def remove_category_meta(uid: str, slug: str) -> None:
    """Drop a category's icon/colour override (on delete)."""
    try:
        await get_db().collection("users").document(uid).update(
            {f"category_meta.{slug}": DELETE_FIELD}
        )
    except Exception as e:  # noqa: BLE001 — best-effort, but a real write failure must be visible
        log.warning("category meta removal of %s failed for %s: %s: %s",
                    slug, uid, type(e).__name__, e)


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
    await remove_category_meta(uid, slug)
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


def _split_by_tier(meter: UsageMeter) -> tuple[int, int, int, int, int]:
    """Collapse per-model token totals into (main_in, main_out, lite_in, lite_out, embed_in).
    Embed model is input-only (no candidates); anything else billed at main rates."""
    main_in = main_out = lite_in = lite_out = embed_in = 0
    for model, (tin, tout) in meter.by_model.items():
        if model == settings.GEMINI_LITE_MODEL:
            lite_in += tin
            lite_out += tout
        elif model == settings.EMBED_MODEL:
            embed_in += tin
        else:
            main_in += tin
            main_out += tout
    return main_in, main_out, lite_in, lite_out, embed_in


async def flush_usage(user_id: str, meter: UsageMeter) -> None:
    """Persist a request's Gemini token usage. Two writes:
      - users/{uid}: lifetime counters (cheap single-doc read powers the dashboard)
      - system/usage-{date}: global daily token totals (powers 'cost today')
    Per-tier so cost can be computed from the two models' different prices. Best-effort:
    a flush failure must never fail the underlying capture/ask."""
    if meter is None or meter.calls == 0:
        return
    main_in, main_out, lite_in, lite_out, embed_in = _split_by_tier(meter)
    fields = {
        "tokens_in_main": Increment(main_in),
        "tokens_out_main": Increment(main_out),
        "tokens_in_lite": Increment(lite_in),
        "tokens_out_lite": Increment(lite_out),
        "tokens_in_embed": Increment(embed_in),
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


async def reserve_backfill_run(user_id: str, app: str) -> bool:
    """Transactionally claim one mini-app backfill run for today (per user, per app).
    Backfill writes are idempotent but their Gemini / enrichment-API spend re-incurs on
    every run, so repeats are capped (MAX_BACKFILLS_PER_APP_PER_DAY). Returns False when
    today's budget for this app is used up — the router turns that into a 429."""
    from google.cloud import firestore as fs

    db = get_db()
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    field = f"backfill_{app}_count"

    @fs.async_transactional
    async def _claim(tx) -> bool:
        ref = db.collection("usage").document(f"{user_id}-{today}")
        snap = await ref.get(transaction=tx)
        n = (snap.to_dict() or {}).get(field, 0)
        if n >= settings.MAX_BACKFILLS_PER_APP_PER_DAY:
            return False
        tx.set(ref, {"user_id": user_id, "date": today, field: n + 1}, merge=True)
        return True

    return await _claim(db.transaction())


async def reserve_collection_rescore(user_id: str, collection_id: str) -> bool:
    """Transactionally claim one collection rescore for today (per user, per collection) —
    same pattern as reserve_backfill_run. Each rescore is a paid query-embed plus a vector
    sweep over the whole corpus, so repeats are capped (MAX_RESCORES_PER_COLLECTION_PER_DAY).
    Returns False when today's budget for this collection is used up — the router turns that
    into a 429."""
    from google.cloud import firestore as fs

    db = get_db()
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    field = f"rescore_{collection_id}_count"

    @fs.async_transactional
    async def _claim(tx) -> bool:
        ref = db.collection("usage").document(f"{user_id}-{today}")
        snap = await ref.get(transaction=tx)
        n = (snap.to_dict() or {}).get(field, 0)
        if n >= settings.MAX_RESCORES_PER_COLLECTION_PER_DAY:
            return False
        tx.set(ref, {"user_id": user_id, "date": today, field: n + 1}, merge=True)
        return True

    return await _claim(db.transaction())


async def reserve_collection_digest(user_id: str, collection_id: str) -> bool:
    """Transactionally claim one collection-digest (re)build for today — same pattern as
    reserve_collection_rescore, but with three tiers instead of one: a digest build is a paid
    Gemini call over up to DIGEST_MAX_NOTES notes at once, so it's capped per collection, per
    user, AND against a global daily kill-switch (MAX_DIGEST_REGENS_PER_COLLECTION_PER_DAY /
    MAX_DIGEST_REGENS_PER_USER_PER_DAY / DAILY_GLOBAL_DIGEST_CAP). Returns False when any of
    today's budgets is used up — the router falls back to the existing cached digest (marked
    stale) rather than a 429, since a digest miss must never break the collection view."""
    from google.cloud import firestore as fs

    db = get_db()
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    coll_field = f"digest_{collection_id}_count"

    @fs.async_transactional
    async def _claim(tx) -> bool:
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_data = user_snap.to_dict() or {}
        global_data = global_snap.to_dict() or {}
        coll_n = user_data.get(coll_field, 0)
        user_n = user_data.get("digest_count", 0)
        global_n = global_data.get("digest_count", 0)
        if coll_n >= settings.MAX_DIGEST_REGENS_PER_COLLECTION_PER_DAY:
            return False
        if user_n >= settings.MAX_DIGEST_REGENS_PER_USER_PER_DAY:
            return False
        if global_n >= settings.DAILY_GLOBAL_DIGEST_CAP:
            return False
        tx.set(user_ref, {
            "user_id": user_id, "date": today,
            coll_field: coll_n + 1, "digest_count": user_n + 1,
        }, merge=True)
        tx.set(global_ref, {"date": today, "digest_count": global_n + 1}, merge=True)
        return True

    return await _claim(db.transaction())


async def reserve_personal_digest(user_id: str) -> bool:
    """Transactionally claim one personal-digest (week-in-review) build for today — same shape as
    reserve_collection_digest, minus the per-collection tier: a build is a paid Gemini call over
    up to DIGEST_MAX_NOTES notes at once, so it's capped per user AND against a global daily
    kill-switch (MAX_MY_DIGEST_BUILDS_PER_USER_PER_DAY / DAILY_GLOBAL_MY_DIGEST_CAP). Returns
    False when either budget is used up — the router falls back to the existing cached digest
    (marked stale) rather than a 429, since a digest miss must never break the home view."""
    from google.cloud import firestore as fs

    db = get_db()
    today = datetime.now(timezone.utc).strftime("%Y%m%d")

    @fs.async_transactional
    async def _claim(tx) -> bool:
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("my_digest_count", 0)
        global_n = (global_snap.to_dict() or {}).get("my_digest_count", 0)
        if user_n >= settings.MAX_MY_DIGEST_BUILDS_PER_USER_PER_DAY:
            return False
        if global_n >= settings.DAILY_GLOBAL_MY_DIGEST_CAP:
            return False
        tx.set(user_ref, {
            "user_id": user_id, "date": today, "my_digest_count": user_n + 1,
        }, merge=True)
        tx.set(global_ref, {"date": today, "my_digest_count": global_n + 1}, merge=True)
        return True

    return await _claim(db.transaction())


async def reserve_apify_slot() -> bool:
    """Transactionally claim one paid-scrape (Apify) slot for today against the global
    daily cap. Returns True if claimed (caller may call Apify), False if the cap is hit
    (caller falls through to the free og-caption path). Never raises — a capped capture
    must still produce a note. Global-only: Apify is the last resort before caption-only,
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
