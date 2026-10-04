"""Note enrichment: TMDB posters + "where to watch" providers merged onto entertainment notes'
`data.titles[]`. Everything is best-effort: a miss (no key, no match, network error) leaves a
valid plain note and must never sink an ingest. Enriched fields are snake_case (poster_url,
providers, ...) vs the camelCase fields the model extracts (source-said vs looked-up).
JustWatch attribution is mandatory wherever providers render (frontend)."""
import logging

from config import settings
from services import tmdb
from services.firebase import get_db
from services.gemini import is_entertainment

log = logging.getLogger("clipnote.enrich")


async def get_user_region(uid: str) -> str:
    """The user's region (ISO-3166-1 alpha-2), set by the frontend on sign-in; feeds streaming
    providers and reservation/order deep-links. Falls back to DEFAULT_WATCH_REGION."""
    try:
        snap = await get_db().collection("users").document(uid).get()
        region = (snap.to_dict() or {}).get("region") if snap.exists else None
    except Exception:  # noqa: BLE001
        region = None
    return (region or settings.DEFAULT_WATCH_REGION).upper()


# ---- entertainment: TMDB ------------------------------------------------------------------

async def _enrich_titles(titles: list, region: str) -> tuple[list, str | None]:
    """Match each extracted title to TMDB and merge poster/providers/overview onto it in place.
    Returns (titles, first_poster_url) — the poster is the cover candidate for coverless notes."""
    cover: str | None = None
    out: list = []
    for t in titles:
        if not isinstance(t, dict) or not (t.get("title") or "").strip():
            out.append(t)
            continue
        try:
            hit = await tmdb.search_title(
                t["title"].strip(), t.get("year"), t.get("mediaType"))
            if hit:
                providers = await tmdb.watch_providers(hit.tmdb_id, hit.media_type, region)
                t = {
                    **t,
                    "title": hit.title,
                    "year": hit.year or t.get("year"),
                    "mediaType": hit.media_type,
                    "tmdb_id": hit.tmdb_id,
                    "poster_url": hit.poster_url,
                    "backdrop_url": hit.backdrop_url,
                    "overview": hit.overview,
                    "genres": hit.genres,
                    "providers": providers,
                    "providers_region": region,
                }
                cover = cover or hit.poster_url
        except Exception as e:  # noqa: BLE001 — one title's miss must not sink the rest.
            log.warning("title enrichment failed for %r: %s: %s",
                        t.get("title"), type(e).__name__, e)
        out.append(t)
    return out, cover


# ---- entry point ----------------------------------------------------------------------------

async def enrich_note_data(user_id: str, content_type: str, data: dict | None,
                           cover_image_url: str | None) -> tuple[dict, str | None]:
    """Enrich a freshly-extracted note's `data` (entertainment titles only). Returns
    (data, cover_override) — a poster to adopt ONLY when the note is otherwise coverless.
    Best-effort: any failure returns the data unchanged."""
    data = data or {}
    cover: str | None = None
    try:
        if is_entertainment(content_type) and isinstance(data.get("titles"), list):
            region = await get_user_region(user_id)
            data["titles"], cover = await _enrich_titles(data["titles"], region)
    except Exception as e:  # noqa: BLE001 — enrichment must never sink an ingest.
        log.warning("note enrichment failed (%s): %s: %s", content_type, type(e).__name__, e)
    return data, (cover if not cover_image_url else None)
