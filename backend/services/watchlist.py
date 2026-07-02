"""Watchlist mini-app: fan extracted entertainment titles out into per-title watch_items.

Each entertainment note can name several works (a "5 films to watch" reel); each distinct work
becomes one trackable doc under users/{uid}/watch_items. Items are deduped by TMDB id across
notes (the same film recommended twice = one item) and carry their own user state
(watch_status / rating / watched_at) which a re-save must never reset.
"""
import logging
import re
from datetime import datetime, timezone

from google.cloud.firestore_v1 import ArrayUnion

from config import settings
from services import search_index, tmdb
from services.firebase import get_db
from services.gemini import gemini_service, is_entertainment

log = logging.getLogger("clipnote.watchlist")


async def get_user_region(uid: str) -> str:
    """The user's "where to watch" region (ISO-3166-1 alpha-2), set by the frontend on
    sign-in; falls back to DEFAULT_WATCH_REGION."""
    try:
        snap = await get_db().collection("users").document(uid).get()
        region = (snap.to_dict() or {}).get("region") if snap.exists else None
    except Exception:  # noqa: BLE001
        region = None
    return (region or settings.DEFAULT_WATCH_REGION).upper()


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "untitled"


def _doc_id(hit: tmdb.TmdbHit | None, title: str, year: str | None) -> str:
    """Stable id → natural dedup. Matched titles key on the TMDB id; unmatched fall back to a
    normalized title|year key so the same raw title doesn't duplicate either."""
    if hit:
        prefix = "t" if hit.media_type == "tv" else "m"
        return f"{prefix}_{hit.tmdb_id}"
    return f"raw_{_slug(title)}_{year or 'na'}"


def _seed_user_state(enrichment: dict, now: datetime, status: str = "saved") -> None:
    """First time a title is seen, seed the owner-editable state. Kept in one place so the
    note-enrichment and manual-add paths stay in sync and never reset existing state.

    `status` is the bucket the item starts in: note-extracted titles land in the `saved` inbox
    (the default) and the user promotes them to `to_watch`; a manual TMDB add skips the inbox
    (searching for a title is intent) and starts on the watchlist."""
    enrichment["watch_status"] = status
    enrichment["rating"] = None
    enrichment["watched_at"] = None
    enrichment["favorite"] = False
    enrichment["created_at"] = now


async def add_by_tmdb(uid: str, tmdb_id: int, media_type: str,
                      region: str | None = None) -> str:
    """Manually add a title the user picked from TMDB search. Upserts the same doc shape as
    note-enrichment (keyed by tmdb id so a later note-mention dedupes to one doc) and seeds user
    state only when new. Returns the doc id. Requires the TMDB token (raises if unavailable)."""
    if media_type not in ("movie", "tv"):
        raise ValueError("media_type must be 'movie' or 'tv'")
    region = region or await get_user_region(uid)
    det = await tmdb.details(tmdb_id, media_type)
    if not det:
        raise ValueError("Title not found on TMDB.")
    providers = await tmdb.watch_providers(tmdb_id, media_type, region)

    db = get_db()
    now = datetime.now(timezone.utc)
    prefix = "t" if media_type == "tv" else "m"
    doc_id = f"{prefix}_{tmdb_id}"
    ref = db.collection("users").document(uid).collection("watch_items").document(doc_id)
    existing = await ref.get()

    enrichment = {
        "user_id": uid,
        "title": det.get("title"),
        "year": det.get("year"),
        "media_type": media_type,
        "tmdb_id": tmdb_id,
        "poster_url": det.get("poster_url"),
        "backdrop_url": det.get("backdrop_url"),
        "overview": det.get("overview"),
        "genres": det.get("genres") or [],
        "providers": providers,
        "providers_region": region,
        "added_manually": True,
        "updated_at": now,
    }
    if not existing.exists:
        _seed_user_state(enrichment, now, status="to_watch")
    await ref.set(enrichment, merge=True)
    await search_index.upsert(
        db, user_id=uid, kind="watch", ref_id=doc_id, title=det.get("title") or "",
        summary=det.get("overview") or "", cover_image_url=det.get("poster_url"),
    )
    return doc_id


async def enrich_titles(uid: str, source_id: str, titles: list[dict],
                        region: str | None = None) -> list[str]:
    """Match each extracted title to TMDB and upsert a watch_item. Best-effort and non-fatal:
    any failure logs and is swallowed so ingest never fails because of TMDB. Returns the list of
    produced watch_item ids (for capture-destination routing). `source_id` is the note id when a
    note exists, else the job id (mini-app captures no longer create a note)."""
    if not titles:
        return []
    region = region or await get_user_region(uid)
    db = get_db()
    now = datetime.now(timezone.utc)
    item_ids: list[str] = []

    for t in titles:
        title = (t.get("title") or "").strip()
        if not title:
            continue
        year = t.get("year")
        media_hint = t.get("mediaType")
        try:
            hit = await tmdb.search_title(title, year, media_hint)
            providers: list[dict] = []
            if hit:
                providers = await tmdb.watch_providers(hit.tmdb_id, hit.media_type, region)

            doc_id = _doc_id(hit, title, year)
            ref = db.collection("users").document(uid).collection("watch_items").document(doc_id)
            existing = await ref.get()

            # Enrichment fields (always refreshed); never touch the user's watch state here.
            enrichment = {
                "user_id": uid,
                "title": hit.title if hit else title,
                "year": (hit.year if hit else year) or None,
                "media_type": hit.media_type if hit else (media_hint or "unknown"),
                "why": t.get("why") or None,
                "source_note_ids": ArrayUnion([source_id]),
                "updated_at": now,
            }
            if hit:
                enrichment.update({
                    "tmdb_id": hit.tmdb_id,
                    "poster_url": hit.poster_url,
                    "backdrop_url": hit.backdrop_url,
                    "overview": hit.overview,
                    "genres": hit.genres,
                    "providers": providers,
                    "providers_region": region,
                })

            if not existing.exists:
                _seed_user_state(enrichment, now)

            await ref.set(enrichment, merge=True)
            await search_index.upsert(
                db, user_id=uid, kind="watch", ref_id=doc_id,
                title=enrichment["title"] or title,
                summary=(hit.overview if hit else None) or t.get("why") or "",
                cover_image_url=hit.poster_url if hit else None,
            )
            item_ids.append(doc_id)
        except Exception as e:  # noqa: BLE001 — one title's failure must not sink the rest.
            log.warning("watch_item enrichment failed for %r: %s: %s",
                        title, type(e).__name__, e)

    return item_ids


async def backfill_user(uid: str, limit: int = 100) -> dict:
    """Populate watch_items from a user's EXISTING entertainment notes (saved before the
    entertainment schema existed, so they carry no titles[]). For each such note we extract
    the named titles from its stored text (no re-scrape) and enrich into watch_items.

    Idempotent: enrich_titles upserts by tmdb id and never clobbers user state, so re-running
    (e.g. once the TMDB token is set, to add posters) is safe. Returns a small summary."""
    db = get_db()
    region = await get_user_region(uid)
    notes_seen = 0
    titles_found = 0
    query = db.collection("notes").where("user_id", "==", uid)
    async for snap in query.stream():
        if notes_seen >= limit:
            break
        note = snap.to_dict() or {}
        if not is_entertainment(note.get("content_type", "")):
            continue
        notes_seen += 1
        try:
            titles = await gemini_service.extract_titles_from_note(
                note.get("title", ""), note.get("ai_summary", ""), note.get("data"),
            )
            if titles:
                titles_found += len(titles)
                await enrich_titles(uid, snap.id, titles, region=region)
        except Exception as e:  # noqa: BLE001 — one note must not sink the backfill.
            log.warning("backfill failed for note %s: %s: %s", snap.id, type(e).__name__, e)
    log.info("watchlist backfill for %s: %d notes, %d titles", uid, notes_seen, titles_found)
    return {"notes_processed": notes_seen, "titles_found": titles_found}
