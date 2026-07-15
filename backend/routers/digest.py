"""Personal digest — the in-app week-in-review.

POST /digest/me — return (rebuilding when stale/forced) the caller's personal digest: a warm,
second-person reflection of what they saved and read this week (an intro + optional qualitative
facts + 2-4 content-derived theme sections that synthesize their notes into read prose, each
deep-linking back to source notes), built by Gemini from the fed note set (services/gemini.py
`build_personal_digest`). The narrative is cached on the user doc (`users/{uid}.digest`), keyed by
a signature of the fed note ids so an unchanged week never re-triggers a paid rebuild.

The endpoint also returns pure-Python STATS over the fed set (counts by type, top domains, busiest
weekday, active days) — computed fresh on every call, never modeled, so the numbers are always
right regardless of digest cache state. A digest miss (empty week, cap exhausted, or a build
failure) never 429s or 500s: the stats and note refs still come back, with `digest` null/stale.

There is NO email path: the old weekly Resend digest was removed in favor of this in-app view.
"""
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from config import settings
from services.auth_dep import require_user
from services.firebase import (
    flush_usage,
    get_db,
    reserve_personal_digest,
)
from services.gemini import gemini_service
from services.usage_meter import start_metering

router = APIRouter(tags=["digest"])
log = logging.getLogger("clipnote.digest")

WINDOW_DAYS = 7


class MyDigestRequest(BaseModel):
    force: bool = False


def _as_datetime(value) -> datetime | None:
    """Firestore timestamps materialize as tz-aware datetimes; anything else (a test int, a
    missing field) is ignored for the date-based stats rather than blowing up a comparison."""
    if isinstance(value, datetime):
        return value
    return None


def _compute_stats(fed: list[dict], fallback: bool, now: datetime) -> dict:
    """Pure-Python stats over the fed note set — never modeled, so the numbers are always right."""
    total = len(fed)
    created = [dt for dt in (_as_datetime(n.get("created_at")) for n in fed) if dt is not None]
    dates = sorted({dt.date() for dt in created})

    if fallback:
        if dates:
            window_start = dates[0]
            window_end = dates[-1]
            window_days = (window_end - window_start).days + 1
        else:
            window_start = window_end = now.date()
            window_days = 1
    else:
        window_end = now.date()
        window_start = (now - timedelta(days=WINDOW_DAYS)).date()
        window_days = WINDOW_DAYS

    cat_counts = Counter(n.get("content_type") or "note" for n in fed)
    categories = [
        {"slug": slug, "count": count}
        for slug, count in cat_counts.most_common()
    ]

    dom_counts = Counter(
        d for d in (n.get("source_domain") for n in fed) if d
    )
    top_domains = [
        {"domain": domain, "count": count}
        for domain, count in dom_counts.most_common(3)
    ]

    weekday_counts = Counter(dt.strftime("%A") for dt in created)
    busiest = weekday_counts.most_common(1)
    busiest_day = (
        {"label": busiest[0][0], "count": busiest[0][1]} if busiest else None
    )

    return {
        "total": total,
        "window_days": window_days,
        "window_start": window_start.isoformat(),
        "window_end": window_end.isoformat(),
        "fallback": fallback,
        "categories": categories,
        "top_domains": top_domains,
        "busiest_day": busiest_day,
        "active_days": len(dates),
    }


def _window_label(fallback: bool, stats: dict) -> str:
    """Human-readable window for the prompt header (steers the intro's framing, not user-facing)."""
    if fallback:
        return "your latest saves"
    start = datetime.fromisoformat(stats["window_start"]).date()
    end = datetime.fromisoformat(stats["window_end"]).date()
    return f"{start.day}-{end.day} {end.strftime('%b %Y')} (the last 7 days)"


def _note_refs(fed: list[dict]) -> list[dict]:
    return [
        {
            "id": n["id"],
            "title": n.get("title") or "Untitled note",
            "content_type": n.get("content_type") or "note",
            "source_domain": n.get("source_domain") or "",
        }
        for n in fed
    ]


@router.post("/digest/me")
async def my_digest(body: MyDigestRequest | None = None,
                    user_id: str = Depends(require_user)):
    """Return the caller's personal week-in-review digest plus fresh stats over the fed note set.

    Response contract:
      `{"digest": <map>|None, "stats": <map>|None, "note_refs": [...], "stale": bool}`.
    - No notes at all → `{digest: None, stats: None, note_refs: [], stale: False}`; no reserve,
      no Gemini call.
    - Fed set = the last-7-days notes when there are at least MY_DIGEST_MIN_WEEK_NOTES of them
      (fallback False); otherwise the newest MY_DIGEST_FALLBACK_NOTES of all saves (fallback True).
    - A signature match (same fed note ids as the last build, same or newer prompt_version, not
      forced) returns the cached digest with `stale: False` — no reserve, no Gemini call. Stats are
      still recomputed fresh.
    - When today's build budget is exhausted (MAX_MY_DIGEST_BUILDS_PER_USER_PER_DAY /
      DAILY_GLOBAL_MY_DIGEST_CAP) or the model call fails, the existing cached digest (possibly
      None) is returned with `stale: True`. A digest miss never 429s or 500s; stats still return.
    """
    body = body or MyDigestRequest()
    db = get_db()
    now = datetime.now(timezone.utc)

    # Fed candidate set: newest DIGEST_MAX_NOTES notes, full docs.
    q = (
        db.collection("notes")
        .where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING")
        .limit(settings.DIGEST_MAX_NOTES)
    )
    fetched: list[dict] = []
    async for doc in q.stream():
        d = doc.to_dict() or {}
        d["id"] = doc.id
        fetched.append(d)

    if not fetched:
        return {"digest": None, "stats": None, "note_refs": [], "stale": False}

    # Prefer the last-7-days window; fall back to the newest N when the week is too sparse.
    cutoff = now - timedelta(days=WINDOW_DAYS)
    week = [
        n for n in fetched
        if (dt := _as_datetime(n.get("created_at"))) is not None and dt >= cutoff
    ]
    if len(week) >= settings.MY_DIGEST_MIN_WEEK_NOTES:
        fed, fallback = week, False
    else:
        fed, fallback = fetched[: settings.MY_DIGEST_FALLBACK_NOTES], True

    stats = _compute_stats(fed, fallback, now)
    note_refs = _note_refs(fed)
    fed_ids = sorted(n["id"] for n in fed)

    user_ref = db.collection("users").document(user_id)
    user_snap = await user_ref.get()
    user_doc = user_snap.to_dict() or {}
    stored = user_doc.get("digest") or {}

    # Cache hit: same fed set, current-or-newer prompt, not forced.
    same_membership = sorted(stored.get("source_note_ids") or []) == fed_ids
    current_prompt = stored.get("prompt_version")
    prompt_current = (
        current_prompt is not None
        and current_prompt >= settings.PERSONAL_DIGEST_PROMPT_VERSION
    )
    if not body.force and same_membership and prompt_current:
        return {"digest": stored, "stats": stats, "note_refs": note_refs, "stale": False}

    if not await reserve_personal_digest(user_id):
        return {"digest": stored or None, "stats": stats,
                "note_refs": note_refs, "stale": True}

    display_name = user_doc.get("display_name") or ""
    meter = start_metering()
    try:
        built = await gemini_service.build_personal_digest(
            display_name, _window_label(fallback, stats), fed)
    finally:
        await flush_usage(user_id, meter)

    if built is None:
        return {"digest": stored or None, "stats": stats,
                "note_refs": note_refs, "stale": True}

    # Ground every section against the fed set the same way the collection digest does: an id the
    # model cited that isn't a fed note must never deep-link into a note it doesn't cover.
    fed_id_set = set(fed_ids)
    for section in built.sections:
        section.source_note_ids = [nid for nid in section.source_note_ids if nid in fed_id_set]
    built.sections = [s for s in built.sections if s.items or s.body.strip()]

    digest_map = {
        "intro": built.intro,
        "facts": [f.model_dump() for f in built.facts],
        "sections": [s.model_dump() for s in built.sections],
        "source_note_ids": fed_ids,
        "generated_at": now,
        "model": settings.GEMINI_MODEL,
        "prompt_version": settings.PERSONAL_DIGEST_PROMPT_VERSION,
        "fallback": fallback,
    }
    # merge=True writes only the `digest` key — sibling user fields (categories, region,
    # display_name, token counters, etc) are left untouched.
    await user_ref.set({"digest": digest_map}, merge=True)
    log.info("personal digest built", extra={"user_id": user_id, "fed": len(fed),
                                             "fallback": fallback})
    return {"digest": digest_map, "stats": stats, "note_refs": note_refs, "stale": False}
