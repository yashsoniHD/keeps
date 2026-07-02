"""TMDB enrichment for the Watchlist mini-app.

Given a title extracted from an entertainment note, match it to a TMDB movie/show and pull
poster, year, overview, genres, and per-region "where to watch" providers. Designed so the
expensive parts (best-hit selection, provider parsing) are pure functions tested offline, while
the HTTP + Firestore-cache layer wraps them.

Auth is the TMDB v4 Read Access Token sent as `Authorization: Bearer` (settings.TMDB_BEARER).
When the token is absent every public function is a graceful no-op (returns None / []), so an
entertainment note still saves and its watch_items render from the raw title.

Provider data ("Streaming data by JustWatch") lags ~8h, so it's cached per (tmdb_id, region).
TMDB is free for this use — no per-user cost cap (unlike Gemini/Imagen).
"""
import asyncio
import logging
import re
import time
from dataclasses import dataclass, field

import httpx

from config import settings
from services.firebase import get_db

log = logging.getLogger("clipnote.tmdb")


@dataclass
class TmdbHit:
    tmdb_id: int
    media_type: str  # "movie" | "tv"
    title: str
    year: str | None = None
    poster_url: str | None = None
    backdrop_url: str | None = None
    overview: str | None = None
    genres: list[str] = field(default_factory=list)


def enabled() -> bool:
    return bool(settings.TMDB_BEARER)


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.TMDB_BEARER}", "accept": "application/json"}


def image_url(path: str | None, size: str = "w500") -> str | None:
    if not path:
        return None
    return f"{settings.TMDB_IMAGE_BASE}/{size}{path}"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _result_title(r: dict) -> str:
    return r.get("title") or r.get("name") or ""


def _result_year(r: dict) -> str | None:
    date = r.get("release_date") or r.get("first_air_date") or ""
    return date[:4] if len(date) >= 4 else None


# ---- pure scoring / parsing (unit-tested offline) ---------------------------------------

def _score(result: dict, q_title: str, year: str | None, media_hint: str | None) -> float:
    """Heuristic match score for one /search/multi result against the wanted title."""
    cand = _norm(_result_title(result))
    want = _norm(q_title)
    if not cand or not want:
        return -1.0
    score = 0.0
    if cand == want:
        score += 5.0
    elif want in cand or cand in want:
        score += 2.0
    else:
        cand_toks, want_toks = set(cand.split()), set(want.split())
        overlap = len(cand_toks & want_toks) / max(1, len(want_toks))
        if overlap < 0.5:
            return -1.0  # too weak — not a confident match
        score += 2.0 * overlap
    if media_hint in ("movie", "tv") and result.get("media_type") == media_hint:
        score += 1.0
    ry = _result_year(result)
    if year and ry:
        try:
            diff = abs(int(year) - int(ry))
            score += 2.0 if diff == 0 else (1.0 if diff == 1 else 0.0)
        except ValueError:
            pass
    score += min(float(result.get("popularity") or 0.0), 1000.0) / 10000.0  # tie-break only
    return score


def _best_hit(results: list[dict], q_title: str, year: str | None,
              media_hint: str | None) -> dict | None:
    """Pick the best movie/tv result, or None if nothing matches confidently."""
    best, best_score = None, 0.0
    for r in results or []:
        if r.get("media_type") not in ("movie", "tv"):
            continue
        s = _score(r, q_title, year, media_hint)
        if s > best_score:
            best, best_score = r, s
    return best


def _hit_from_result(r: dict, genre_names: dict[int, str] | None = None) -> TmdbHit:
    genre_names = genre_names or {}
    genres = [genre_names[g] for g in (r.get("genre_ids") or []) if g in genre_names]
    return TmdbHit(
        tmdb_id=int(r["id"]),
        media_type=r.get("media_type", "movie"),
        title=_result_title(r),
        year=_result_year(r),
        poster_url=image_url(r.get("poster_path"), "w500"),
        backdrop_url=image_url(r.get("backdrop_path"), "w780"),
        overview=r.get("overview") or None,
        genres=genres,
    )


def _search_result(r: dict) -> dict:
    """Map one /search/multi result to a lean candidate for the manual-add picker."""
    return {
        "tmdb_id": int(r["id"]),
        "media_type": r.get("media_type", "movie"),
        "title": _result_title(r),
        "year": _result_year(r),
        "poster_url": image_url(r.get("poster_path"), "w185"),
        "overview": r.get("overview") or None,
    }


def _parse_details(raw: dict, media_type: str) -> dict:
    """Flatten a TMDB /movie/{id} or /tv/{id} (with append_to_response=credits) into a
    frontend-ready details map. Pure — unit-tested offline."""
    date = raw.get("release_date") or raw.get("first_air_date") or ""
    runtimes = raw.get("episode_run_time") or []
    cast = [
        {
            "name": c.get("name"),
            "character": c.get("character") or None,
            "profile_url": image_url(c.get("profile_path"), "w185"),
        }
        for c in (raw.get("credits", {}).get("cast") or [])[:10]
        if c.get("name")
    ]
    return {
        "tmdb_id": int(raw["id"]),
        "media_type": media_type,
        "title": raw.get("title") or raw.get("name") or "",
        "year": date[:4] if len(date) >= 4 else None,
        "tagline": raw.get("tagline") or None,
        "overview": raw.get("overview") or None,
        "poster_url": image_url(raw.get("poster_path"), "w500"),
        "backdrop_url": image_url(raw.get("backdrop_path"), "w1280"),
        "genres": [g["name"] for g in (raw.get("genres") or []) if g.get("name")],
        "runtime": raw.get("runtime") or None,  # minutes (movie)
        "number_of_seasons": raw.get("number_of_seasons") or None,  # tv
        "number_of_episodes": raw.get("number_of_episodes") or None,  # tv
        "episode_run_time": (runtimes[0] if runtimes else None),  # minutes/ep (tv)
        "status": raw.get("status") or None,  # "Released", "Returning Series", ...
        "vote_average": round(float(raw.get("vote_average") or 0.0), 1) or None,
        "vote_count": raw.get("vote_count") or None,
        "cast": cast,
    }


def _parse_providers(provider_data: dict, region: str) -> list[dict]:
    """Flatten TMDB watch/providers `results[region]` into a flat, frontend-ready list.
    flatrate (subscription) first, then rent, then buy; dedup by provider name."""
    region_block = (provider_data.get("results") or {}).get(region) or {}
    out: list[dict] = []
    seen: set[str] = set()
    for kind in ("flatrate", "rent", "buy"):
        for p in region_block.get(kind) or []:
            name = p.get("provider_name")
            if not name or name in seen:
                continue
            seen.add(name)
            out.append({
                "name": name,
                "logo_url": image_url(p.get("logo_path"), "w92"),
                "type": kind,
            })
    return out


# ---- HTTP + Firestore cache -------------------------------------------------------------

# Genre id→name maps are tiny and rarely change; cache process-wide for the worker's lifetime.
_genre_cache: dict[str, dict[int, str]] = {}


def _http_get_sync(path: str, params: dict | None = None) -> dict | None:
    try:
        with httpx.Client(base_url=settings.TMDB_API_BASE, headers=_headers(), timeout=8.0) as c:
            resp = c.get(path, params=params or {})
            resp.raise_for_status()
            return resp.json()
    except Exception as e:  # noqa: BLE001 — enrichment is best-effort; never raise into ingest.
        log.warning("tmdb GET %s failed: %s: %s", path, type(e).__name__, e)
        return None


async def _http_get(path: str, params: dict | None = None) -> dict | None:
    return await asyncio.to_thread(_http_get_sync, path, params)


async def _genre_names(media_type: str) -> dict[int, str]:
    if media_type not in ("movie", "tv"):
        return {}
    if media_type in _genre_cache:
        return _genre_cache[media_type]
    data = await _http_get(f"/genre/{media_type}/list")
    names = {int(g["id"]): g["name"] for g in (data or {}).get("genres", [])}
    if names:
        _genre_cache[media_type] = names
    return names


async def _cache_get(key: str, ttl_seconds: int) -> dict | None:
    try:
        snap = await get_db().collection("tmdb_cache").document(key).get()
        if not snap.exists:
            return None
        doc = snap.to_dict() or {}
        if time.time() - (doc.get("cached_at") or 0) > ttl_seconds:
            return None
        return doc.get("payload")
    except Exception:  # noqa: BLE001
        return None


async def _cache_set(key: str, payload: dict) -> None:
    try:
        await get_db().collection("tmdb_cache").document(key).set(
            {"payload": payload, "cached_at": time.time()}, merge=True
        )
    except Exception:  # noqa: BLE001
        pass


async def search_title(title: str, year: str | None = None,
                       media_hint: str | None = None) -> TmdbHit | None:
    """Match a free-text title to a TMDB movie/show. Returns None when disabled, on a miss,
    or on any error — the caller keeps the raw title and leaves tmdb fields null."""
    if not enabled() or not title:
        return None
    data = await _http_get("/search/multi", {"query": title, "include_adult": "false"})
    if not data:
        return None
    best = _best_hit(data.get("results", []), title, year, media_hint)
    if not best:
        return None
    genre_names = await _genre_names(best.get("media_type", "movie"))
    return _hit_from_result(best, genre_names)


async def search(query: str, limit: int = 12) -> list[dict]:
    """Free-text search for the manual-add picker. Returns lean movie/tv candidates ordered by
    popularity. No-op ([]) when disabled or the query is blank."""
    if not enabled() or not (query or "").strip():
        return []
    data = await _http_get("/search/multi", {"query": query, "include_adult": "false"})
    if not data:
        return []
    results = [
        r for r in data.get("results", [])
        if r.get("media_type") in ("movie", "tv") and r.get("id")
    ]
    results.sort(key=lambda r: float(r.get("popularity") or 0.0), reverse=True)
    return [_search_result(r) for r in results[:limit]]


async def details(tmdb_id: int, media_type: str) -> dict | None:
    """Full title details (cast/runtime/seasons/rating) for the detail page. Cached per id for
    TMDB_DETAIL_CACHE_HOURS. Returns None when disabled, on a miss, or on error."""
    if not enabled() or media_type not in ("movie", "tv"):
        return None
    cache_key = f"detail_{media_type}_{tmdb_id}"
    cached = await _cache_get(cache_key, settings.TMDB_DETAIL_CACHE_HOURS * 3600)
    if cached is not None:
        return cached
    data = await _http_get(f"/{media_type}/{tmdb_id}", {"append_to_response": "credits"})
    if not data or not data.get("id"):
        return None
    parsed = _parse_details(data, media_type)
    await _cache_set(cache_key, parsed)
    return parsed


async def watch_providers(tmdb_id: int, media_type: str, region: str) -> list[dict]:
    """Per-region "where to watch" for a title (flatrate first). Cached per (id, region)."""
    if not enabled() or media_type not in ("movie", "tv"):
        return []
    region = (region or settings.DEFAULT_WATCH_REGION).upper()
    cache_key = f"prov_{media_type}_{tmdb_id}_{region}"
    cached = await _cache_get(cache_key, settings.TMDB_PROVIDER_CACHE_HOURS * 3600)
    if cached is not None:
        return cached.get("providers", [])
    data = await _http_get(f"/{media_type}/{tmdb_id}/watch/providers")
    if data is None:
        return []
    providers = _parse_providers(data, region)
    await _cache_set(cache_key, {"providers": providers})
    return providers
