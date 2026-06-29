"""GET /api/admin/stats — operator dashboard data (gated to ADMIN_EMAILS).

Joins three sources: Firebase Auth (identity, signup, last sign-in), Firestore notes
(per-user count() aggregations — no doc reads billed), and the lifetime token counters
flush_usage writes to users/{uid}. Cost is derived from raw tokens at read-time using
the config price table, so it always reflects current pricing.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException

from config import settings
from services.firebase import get_db, list_auth_users, verify_firebase_token_claims

router = APIRouter(tags=["admin"])
log = logging.getLogger("clipnote.admin")


async def require_admin(authorization: str | None = Header(default=None)) -> str:
    """Admin gate: a verified Firebase email in ADMIN_EMAILS. PATs are rejected outright."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = authorization.removeprefix("Bearer ")
    if token.startswith("cn_"):
        raise HTTPException(403, "Admin dashboard requires a web sign-in")
    try:
        claims = await verify_firebase_token_claims(token)
    except Exception:
        raise HTTPException(401, "Invalid token")
    email = (claims.get("email") or "").lower()
    if not claims.get("email_verified") or email not in settings.ADMIN_EMAILS:
        raise HTTPException(403, "Not authorized")
    return claims["uid"]


def _cost_usd(
    ti_main: int, to_main: int, ti_lite: int, to_lite: int,
    images: int = 0, ti_embed: int = 0,
) -> float:
    """Per-tier token totals (+ generated images) → USD, using config prices
    (tokens priced per 1M; images per-image)."""
    token_cost = (
        ti_main * settings.GEMINI_PRICE_IN
        + to_main * settings.GEMINI_PRICE_OUT
        + ti_lite * settings.GEMINI_LITE_PRICE_IN
        + to_lite * settings.GEMINI_LITE_PRICE_OUT
        + ti_embed * settings.EMBED_PRICE_IN
    ) / 1_000_000
    return token_cost + images * settings.IMAGEN_PRICE_PER_IMAGE


@router.get("/admin/stats")
async def admin_stats(_: str = Depends(require_admin)):
    db = get_db()
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y%m%d")
    d7 = (now - timedelta(days=7)).strftime("%Y%m%d")
    d30 = (now - timedelta(days=30)).strftime("%Y%m%d")

    # Identity from Auth; lifetime token counters from the users/{uid} Firestore docs.
    auth_users = await list_auth_users()
    user_docs: dict[str, dict] = {}
    async for doc in db.collection("users").stream():
        user_docs[doc.id] = doc.to_dict() or {}

    # Active users = anyone with a usage doc (capture or ask) in the window. One query;
    # usage doc ids are {uid}-{YYYYMMDD} and carry user_id + date fields.
    active7: set[str] = set()
    active30: set[str] = set()
    async for doc in db.collection("usage").where("date", ">=", d30).stream():
        d = doc.to_dict() or {}
        uid, date = d.get("user_id"), d.get("date", "")
        if not uid:
            continue
        active30.add(uid)
        if date >= d7:
            active7.add(uid)

    per_user = []
    total_cost = total_tokens = total_images = 0
    signups_by_source: dict[str, int] = {}  # acquisition channel → signups (P1.3 attribution)
    for u in auth_users:
        uid = u["uid"]
        prof = user_docs.get(uid, {})
        src = prof.get("signup_ref") or "unknown"
        signups_by_source[src] = signups_by_source.get(src, 0) + 1
        ti_main = prof.get("lifetime_tokens_in_main", 0)
        to_main = prof.get("lifetime_tokens_out_main", 0)
        ti_lite = prof.get("lifetime_tokens_in_lite", 0)
        to_lite = prof.get("lifetime_tokens_out_lite", 0)
        ti_embed = prof.get("lifetime_tokens_in_embed", 0)
        images = prof.get("lifetime_images", 0)
        cost = _cost_usd(ti_main, to_main, ti_lite, to_lite, images, ti_embed)
        tokens = ti_main + to_main + ti_lite + to_lite
        total_cost += cost
        total_tokens += tokens
        total_images += images

        notes_agg = await db.collection("notes").where("user_id", "==", uid).count().get()
        notes = notes_agg[0][0].value

        per_user.append({
            "uid": uid,
            "email": u.get("email"),
            "display_name": u.get("display_name"),
            "created_at": u.get("created_at"),       # epoch ms
            "last_sign_in": u.get("last_sign_in"),   # epoch ms
            "notes": notes,
            "tokens_in": ti_main + ti_lite,
            "tokens_out": to_main + to_lite,
            "tokens": tokens,
            "images": images,
            "ai_calls": prof.get("lifetime_ai_calls", 0),
            "cost_usd": round(cost, 4),
            "cost_inr": round(cost * settings.USD_TO_INR, 2),
            "active_7d": uid in active7,
            "active_30d": uid in active30,
        })

    per_user.sort(key=lambda r: r["cost_usd"], reverse=True)

    total_notes = (await db.collection("notes").count().get())[0][0].value
    jobs_total = (await db.collection("jobs").count().get())[0][0].value
    jobs_failed = (
        await db.collection("jobs").where("status", "==", "failed").count().get()
    )[0][0].value

    # 30-day daily trend from system/usage-{YYYYMMDD} rollup docs.
    trend_docs: dict[str, dict] = {}
    async for doc in db.collection("system").where("date", ">=", d30).stream():
        d_data = doc.to_dict() or {}
        date_key = d_data.get("date", "")
        if date_key:
            trend_docs[date_key] = d_data

    daily_trend = []
    for i in range(29, -1, -1):
        day = (now - timedelta(days=i)).strftime("%Y%m%d")
        d_data = trend_docs.get(day, {})
        notes_d = d_data.get("note_count", 0)
        asks_d = d_data.get("ask_count", 0)
        images_d = d_data.get("image_count", 0)
        daily_cost = _cost_usd(
            d_data.get("tok_tokens_in_main", 0),
            d_data.get("tok_tokens_out_main", 0),
            d_data.get("tok_tokens_in_lite", 0),
            d_data.get("tok_tokens_out_lite", 0),
            images_d,
            d_data.get("tok_tokens_in_embed", 0),
        )
        daily_trend.append({
            "date": day,
            "notes": notes_d,
            "asks": asks_d,
            "images": images_d,
            "cost_usd": round(daily_cost, 4),
        })

    sys_today = trend_docs.get(today, {})
    cost_per_note = total_cost / total_notes if total_notes > 0 else 0

    # --- Funding metrics: activation, retention, acquisition (the pitch-deck data) ---
    now_ms = now.timestamp() * 1000
    day_ms = 86_400_000
    users_n = len(auth_users)
    activated = sum(1 for r in per_user if r["notes"] > 0)  # signup → at least one note
    new_7d = sum(1 for r in per_user if (r["created_at"] or 0) >= now_ms - 7 * day_ms)
    new_30d = sum(1 for r in per_user if (r["created_at"] or 0) >= now_ms - 30 * day_ms)
    # Retention proxy: of accounts old enough to return (signed up >7d ago), the share that
    # were active in the last 7d. Not a true signup-day cohort, but an honest "are users
    # sticking around" signal computable from the data we have.
    eligible_7d = [r for r in per_user if (r["created_at"] or 0) <= now_ms - 7 * day_ms]
    retained_7d = sum(1 for r in eligible_7d if r["active_7d"])

    return {
        "generated_at": now.isoformat(),
        "totals": {
            "users": users_n,
            "notes": total_notes,
            "active_7d": len(active7),
            "active_30d": len(active30),
            "activated": activated,
            "activation_rate": round(activated / users_n, 3) if users_n else 0,
            "new_users_7d": new_7d,
            "new_users_30d": new_30d,
            "retained_7d": round(retained_7d / len(eligible_7d), 3) if eligible_7d else 0,
            "tokens": total_tokens,
            "images": total_images,
            "cost_usd": round(total_cost, 2),
            "cost_inr": round(total_cost * settings.USD_TO_INR, 2),
            "cost_per_note_usd": round(cost_per_note, 4),
            "cost_per_active_user_usd": round(total_cost / len(active30), 4) if active30 else 0,
            "jobs": jobs_total,
            "jobs_failed": jobs_failed,
            "notes_today": sys_today.get("note_count", 0),
            "asks_today": sys_today.get("ask_count", 0),
            "images_today": sys_today.get("image_count", 0),
        },
        "signups_by_source": signups_by_source,
        "pricing_note": "Cost uses configured Gemini + Imagen prices — verify GEMINI_PRICE_* and IMAGEN_PRICE_PER_IMAGE against live Vertex pricing.",
        "daily_trend": daily_trend,
        "users": per_user,
    }
