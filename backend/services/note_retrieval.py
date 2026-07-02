"""Note retrieval for Ask AI — the grounding-set builders.

Extracted from `routers/ask.py` so both the legacy `/api/ask` endpoint and the new agent
(`services/agent_tools.py`) can build grounding sets without a router↔service import cycle.

Retrieval is built from an `AskPlan` (or the orchestrator's tool args mapped onto one):
  - source set      → brand-matched newest-notes scan (Firestore can't substring-match)
  - period set      → tz-aware date-window query (user's local day, not UTC)
  - exhaustive/type → the full filtered set by type, not a top-K shortlist
  - otherwise       → the planner's semantic picks from a recent ∪ vector candidate pool
"""
import asyncio
import logging
from datetime import datetime, timedelta

from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

from config import settings
from models.ask import AskPlan
from services import search_index
from services.embeddings import embedding_service
from services.gemini import normalize_slug
from services.source_alias import source_matches

log = logging.getLogger("clipnote.retrieval")

# Mini-app item kinds live in search_index alongside notes. Their grounding ids are prefixed
# ("recipe-r_abc") so a single id space covers notes (raw uuids) AND items; the prefix tells the
# resolver which subcollection to read and lets a citation route to /<app>/$itemId.
ITEM_KINDS = ("watch", "wish", "recipe", "place", "trip")
_KIND_TO_COLLECTION = {k: f"{k}_items" for k in ITEM_KINDS}


def _prefixed_id(kind: str, ref_id: str) -> str:
    return f"{kind}-{ref_id}"


def _split_id(gid: str) -> tuple[str | None, str]:
    """(kind, ref_id) for a mini-app item id; (None, gid) for a plain note id. Note ids are
    uuids, which never collide with the 'watch-/wish-/recipe-/place-/trip-' item prefixes."""
    for k in ITEM_KINDS:
        if gid.startswith(k + "-"):
            return k, gid[len(k) + 1:]
    return None, gid

# Index fields the planner and citations need, WITHOUT the heavy `data` map (projection
# keeps the candidate-pool read cheap). created_at lets the planner reason about dates.
INDEX_FIELDS = ["content_type", "title", "ai_summary", "source_domain", "cover_image_url", "created_at"]

_PERIOD_LABELS = {
    "today": "today", "yesterday": "yesterday", "this_week": "this week",
    "last_week": "last week", "this_month": "this month", "recent": "recently",
}


def period_label(period: str) -> str:
    return _PERIOD_LABELS.get(period, "then")


def period_bounds(period: str, tz_offset_minutes: int,
                  now_utc: datetime) -> tuple[datetime, datetime] | None:
    """Resolve a period keyword to a [after, before) UTC window using the user's local day.
    The model only picks the keyword; the date math is done here (deterministic)."""
    offset = timedelta(minutes=tz_offset_minutes)
    local_now = now_utc + offset
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    def to_utc(local_dt: datetime) -> datetime:
        return local_dt - offset  # local = utc + offset  ⇒  utc = local - offset

    if period == "today":
        return to_utc(local_midnight), now_utc
    if period == "yesterday":
        return to_utc(local_midnight - timedelta(days=1)), to_utc(local_midnight)
    if period == "this_week":
        week_start = local_midnight - timedelta(days=local_now.weekday())
        return to_utc(week_start), now_utc
    if period == "last_week":
        week_start = local_midnight - timedelta(days=local_now.weekday())
        return to_utc(week_start - timedelta(days=7)), to_utc(week_start)
    if period == "this_month":
        return to_utc(local_midnight.replace(day=1)), now_utc
    if period == "recent":
        return now_utc - timedelta(days=7), now_utc
    return None


def type_variants(content_types: list[str]) -> list[str]:
    """Normalize requested type slugs + singular/plural variants (planner may say
    'recipes' while notes store 'recipe'). Capped at 10 for Firestore `in` queries."""
    variants: list[str] = []
    for t in content_types:
        n = normalize_slug(t)
        for v in (n, n.rstrip("s"), n + "s"):
            if v and v not in variants:
                variants.append(v)
    return variants[:10]


def filter_types(notes: list[dict], content_types: list[str]) -> list[dict]:
    if not content_types:
        return notes
    targets = set(type_variants(content_types))
    return [n for n in notes if normalize_slug(n.get("content_type", "")) in targets]


async def recent_notes(db, user_id: str, limit: int) -> list[dict]:
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING")
        .limit(limit).select(INDEX_FIELDS)
    )
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


async def vector_shortlist(db, user_id: str, question: str) -> list[dict] | None:
    """Top-K candidate notes by semantic similarity (Firestore Vector Search). Returns
    None when the query embedding is unavailable so the caller falls back to recency alone."""
    try:
        query_vec = await embedding_service.embed_query(question)
    except Exception as e:
        log.warning("ask shortlist embedding failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": user_id})
        return None
    if not query_vec:
        return None
    vector_query = db.collection("notes").where("user_id", "==", user_id).find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_vec),
        distance_measure=DistanceMeasure.COSINE,
        limit=settings.ASK_SHORTLIST_K,
    )
    return [
        {"id": doc.id, **{f: (doc.to_dict() or {}).get(f) for f in INDEX_FIELDS}}
        async for doc in vector_query.stream()
    ]


async def item_shortlist(db, user_id: str, question: str) -> list[dict]:
    """Top-K mini-app items by semantic similarity, so Clip AI can ground answers on saved
    movies/restaurants/recipes/etc. Reads the unified search_index vector index and shapes each
    hit like a note (prefixed id + kind/app), so the planner and answer stages need no item
    special-casing. Best-effort — a miss just means items are absent from this pool."""
    try:
        query_vec = await embedding_service.embed_query(question)
    except Exception as e:  # noqa: BLE001
        log.warning("item shortlist embedding failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": user_id})
        return []
    if not query_vec:
        return []
    try:
        vector_query = db.collection(search_index.COLLECTION).where(
            "user_id", "==", user_id).find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_vec),
            distance_measure=DistanceMeasure.COSINE,
            limit=settings.ASK_SHORTLIST_K,
        )
        out: list[dict] = []
        async for doc in vector_query.stream():
            d = doc.to_dict() or {}
            if d.get("kind") not in ITEM_KINDS or not d.get("ref_id"):
                continue  # notes come from the notes-collection pool; skip note entries here
            out.append({
                "id": _prefixed_id(d["kind"], d["ref_id"]),
                "kind": d["kind"], "app": d.get("app"), "ref_id": d["ref_id"],
                "content_type": d["kind"], "title": d.get("title", ""),
                "ai_summary": d.get("summary") or "", "source_domain": "",
                "cover_image_url": d.get("cover_image_url"), "created_at": d.get("created_at"),
            })
        return out
    except Exception as e:  # noqa: BLE001 — vector index may be missing in some envs.
        log.warning("item shortlist query failed: %s: %s", type(e).__name__, e,
                    extra={"user_id": user_id})
        return []


async def candidate_pool(db, user_id: str, question: str) -> list[dict]:
    """The grounding pool the planner chooses from: most-recent notes (temporal coverage) ∪
    vector top-K notes (deep-semantic coverage) ∪ vector top-K mini-app items (so Clip AI can
    answer about saved movies/restaurants/recipes), deduped by id."""
    recent = await recent_notes(db, user_id, settings.ASK_RECENT_POOL)
    pool = {n["id"]: n for n in recent}
    shortlist = await vector_shortlist(db, user_id, question)
    if shortlist:
        for n in shortlist:
            pool.setdefault(n["id"], n)
    for it in await item_shortlist(db, user_id, question):
        pool.setdefault(it["id"], it)
    return list(pool.values())


def dated_index(pool: list[dict], tz_offset_minutes: int) -> list[dict]:
    offset = timedelta(minutes=tz_offset_minutes)
    index = []
    for n in pool:
        created = n.get("created_at")
        saved = ""
        if created is not None:
            try:
                saved = (created + offset).strftime("%Y-%m-%d")
            except Exception:
                saved = ""
        index.append({
            "id": n["id"],
            "type": n.get("content_type", ""),
            "title": n.get("title", ""),
            "summary": (n.get("ai_summary") or "")[:200],
            "saved": saved,
        })
    return index


def _item_to_grounding(kind: str, ref_id: str, d: dict) -> dict:
    """Shape a mini-app item doc like a note so the answer/synthesis stages need no per-kind
    branching. `data` carries the item's descriptive fields; `app`/`ref_id` drive citation routing."""
    return {
        "id": _prefixed_id(kind, ref_id),
        "kind": kind,
        "app": search_index.APP_BY_KIND.get(kind),
        "ref_id": ref_id,
        "content_type": kind,
        "title": d.get("title") or d.get("name") or "",
        "ai_summary": d.get("ai_summary") or d.get("why") or d.get("verdict") or "",
        "cover_image_url": d.get("poster_url") or d.get("image_url") or d.get("photo_url"),
        "source_domain": d.get("domain") or "",
        "data": d,
    }


async def _fetch_item(db, user_id: str, kind: str, ref_id: str) -> dict | None:
    snap = await (db.collection("users").document(user_id)
                  .collection(_KIND_TO_COLLECTION[kind]).document(ref_id).get())
    d = snap.to_dict() if snap.exists else None
    if not d or d.get("user_id") != user_id:
        return None
    return _item_to_grounding(kind, ref_id, d)


async def fetch_notes_by_ids(db, user_id: str, ids: list[str]) -> list[dict]:
    """Resolve grounding ids to full docs, preserving order. Plain uuids read from `notes`;
    'watch-/wish-/recipe-/place-/trip-'-prefixed ids read from the matching mini-app
    subcollection and are adapted to the note shape."""
    note_ids: list[str] = []
    item_refs: list[tuple[str, str]] = []
    for gid in ids:
        kind, ref = _split_id(gid)
        (item_refs.append((kind, ref)) if kind else note_ids.append(gid))

    resolved: dict[str, dict] = {}
    if note_ids:
        snaps = await asyncio.gather(
            *(db.collection("notes").document(nid).get() for nid in note_ids)
        )
        for nid, snap in zip(note_ids, snaps):
            data = snap.to_dict() if snap.exists else None
            if data and data.get("user_id") == user_id:
                resolved[nid] = {"id": nid, **data}
    if item_refs:
        items = await asyncio.gather(
            *(_fetch_item(db, user_id, k, r) for k, r in item_refs)
        )
        for it in items:
            if it:
                resolved[it["id"]] = it
    return [resolved[gid] for gid in ids if gid in resolved]


async def fetch_notes_by_window(db, user_id: str, after: datetime, before: datetime,
                                cap: int) -> list[dict]:
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .where("created_at", ">=", after).where("created_at", "<", before)
        .order_by("created_at", direction="DESCENDING").limit(cap)
    )
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


async def fetch_notes_by_source(db, user_id: str, source: str, cap: int) -> list[dict]:
    """Notes from a named source ("my Pinterest notes"). Firestore can't substring-match,
    so scan the newest notes (using the existing user_id+created_at index) and filter in
    Python — cheap reads, no extra index, tolerant of subdomains and a stale `sources` list.
    Matches on the canonical brand (so pin.it counts as pinterest, youtu.be as youtube) and
    keeps a raw substring check for anything the alias map doesn't know about."""
    keyword = source.lower().strip()
    if not keyword:
        return []
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .order_by("created_at", direction="DESCENDING").limit(300)
    )
    matched = []
    async for doc in query.stream():
        domain = ((doc.to_dict() or {}).get("source_domain") or "").lower()
        if source_matches(domain, keyword):
            matched.append({"id": doc.id, **doc.to_dict()})
            if len(matched) >= cap:
                break
    return matched


async def fetch_notes_by_types(db, user_id: str, content_types: list[str],
                               cap: int) -> list[dict]:
    variants = type_variants(content_types)
    if not variants:
        return []
    query = (
        db.collection("notes").where("user_id", "==", user_id)
        .where("content_type", "in", variants)
        .order_by("created_at", direction="DESCENDING").limit(cap)
    )
    return [{"id": doc.id, **doc.to_dict()} async for doc in query.stream()]


async def retrieve_notes(db, user_id: str, plan: AskPlan, pool: list[dict],
                         tz_offset_minutes: int, now_utc: datetime) -> tuple[list[dict], int]:
    """Build the grounding note set from the plan. Returns (notes_to_answer_from,
    total_matched) so the caller can report coverage when the set was capped."""
    # Source-scoped ("my Pinterest notes"), optionally narrowed by type.
    if plan.source:
        matched = await fetch_notes_by_source(db, user_id, plan.source,
                                              settings.ASK_EXHAUSTIVE_CAP)
        matched = filter_types(matched, plan.content_types)
        cap = settings.ASK_EXHAUSTIVE_CAP if plan.exhaustive else settings.ASK_MAX_GROUNDED_NOTES
        return matched[:cap], len(matched)

    # Temporal: date-bounded query (optionally narrowed by type).
    if plan.period:
        bounds = period_bounds(plan.period, tz_offset_minutes, now_utc)
        if bounds:
            after, before = bounds
            matched = await fetch_notes_by_window(db, user_id, after, before,
                                                  settings.ASK_EXHAUSTIVE_CAP)
            matched = filter_types(matched, plan.content_types)
            cap = settings.ASK_EXHAUSTIVE_CAP if plan.exhaustive else settings.ASK_MAX_GROUNDED_NOTES
            return matched[:cap], len(matched)

    # Exhaustive / aggregate by type: the full filtered set, not a top-K shortlist.
    if plan.content_types and (plan.exhaustive or plan.intent == "aggregate"):
        matched = await fetch_notes_by_types(db, user_id, plan.content_types,
                                             settings.ASK_EXHAUSTIVE_CAP)
        return matched[: settings.ASK_EXHAUSTIVE_CAP], len(matched)

    # Semantic: the planner's picks from the candidate pool.
    known = {n["id"] for n in pool}
    ids = [i for i in dict.fromkeys(plan.note_ids) if i in known][: settings.ASK_MAX_GROUNDED_NOTES]
    if not ids:
        return [], 0
    notes = await fetch_notes_by_ids(db, user_id, ids)
    return notes, len(notes)
