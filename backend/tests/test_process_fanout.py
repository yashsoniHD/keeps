"""Ingest-time mini-app fan-out: a processed family capture lands on its wall immediately.

The worker calls fan_out_note after the note is written, so a fresh entertainment capture creates
its watch_items doc (with the m_/t_{tmdb_id} id the WatchNote poster deep-link targets) without a
manual backfill. Cost-safe: the note's data already carries the enriched titles[] from
enrich_note_data, so fan-out must trigger NO second Gemini extraction and NO TMDB re-lookup —
the tests below make both blow up if called. Best-effort: a fan-out failure never fails the job.
"""
import pytest

import routers.process as process
import services.watchlist as watchlist_mod
from models.note import ContentBundle, NoteExtraction


class DummyRequest:
    headers = {}


# Enriched titles[] exactly as enrich_note_data leaves them on the note (TMDB fields merged in).
ENRICHED_TITLES = {"titles": [{
    "title": "Dune: Part Two", "year": "2024", "mediaType": "movie", "why": "epic",
    "tmdb_id": 693134, "poster_url": "https://img/dune.jpg", "backdrop_url": None,
    "overview": "Paul Atreides unites with the Fremen.", "genres": ["Sci-Fi"],
    "providers": [{"name": "JioCinema"}], "providers_region": "IN",
}]}


@pytest.fixture(autouse=True)
def wire(fake_db, monkeypatch):
    """Happy-path worker wiring (same shape as test_process_routing) + tripwires proving the
    fan-out spends nothing: Gemini re-extraction and TMDB lookups raise if ever reached."""
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)
    monkeypatch.setattr(watchlist_mod, "get_db", lambda: fake_db)

    async def _noop(*a, **k):
        return None

    async def cats(uid):
        return []

    async def cols(uid):
        return []

    async def classify(url, bundle, existing, note_hint=None):
        return "movie"

    async def extract(url, bundle, ct, note_hint=None):
        return NoteExtraction(content_type=ct, title="5 sci-fi films", ai_summary="A roundup.",
                              cover_image_prompt="",
                              data={"titles": [{"title": "Dune: Part Two", "why": "epic"}]})

    async def acquire(url):
        return ContentBundle(kind="text", text="x" * 60, metadata={"platform": "web"},
                             strategy="web_scrape")

    async def fake_enrich(user_id, ct, d, cover):
        return dict(ENRICHED_TITLES), "https://img/dune.jpg"

    async def gemini_tripwire(*a, **k):
        raise AssertionError("fan-out must not re-run Gemini extraction at ingest")

    async def tmdb_tripwire(*a, **k):
        raise AssertionError("fan-out must not re-query TMDB for already-enriched titles")

    monkeypatch.setattr(process, "get_user_categories", cats)
    monkeypatch.setattr(process, "get_user_collections", cols)
    monkeypatch.setattr(process, "add_user_category", _noop)
    monkeypatch.setattr(process, "add_user_source", _noop)
    monkeypatch.setattr(process, "touch_user_activity", _noop)
    monkeypatch.setattr(process, "_note_embedding", _noop)
    monkeypatch.setattr(process, "enrich_note_data", fake_enrich)
    monkeypatch.setattr(process.gemini_service, "classify", classify)
    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "acquire", acquire)
    monkeypatch.setattr("services.gemini.gemini_service.extract_titles_from_note",
                        gemini_tripwire, raising=False)
    monkeypatch.setattr("services.tmdb.search_title", tmdb_tripwire)
    monkeypatch.setattr("services.tmdb.watch_providers", tmdb_tripwire)


def _watch_keys(fake_db):
    return [k for k in fake_db.docs if k[0] == "users/u/watch_items"]


async def test_entertainment_capture_creates_watch_item_with_tmdb_id(fake_db):
    """A processed movie note lands in watch_items under m_{tmdb_id} — the exact id the
    WatchNote poster deep-link (/watchlist/m_693134) navigates to — with the enriched fields
    passed through (no TMDB re-lookup; the tripwires prove it)."""
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/films"})
    res = await process.process_job("j", DummyRequest())
    assert res["status"] == "completed"

    keys = _watch_keys(fake_db)
    assert keys == [("users/u/watch_items", "m_693134")]
    item = fake_db.docs[keys[0]]
    assert item["title"] == "Dune: Part Two"
    assert item["tmdb_id"] == 693134
    assert item["poster_url"] == "https://img/dune.jpg"
    assert item["providers"] == [{"name": "JioCinema"}]
    assert item["providers_region"] == "IN"          # region carried from enrichment, not refetched
    assert item["watch_status"] == "saved"           # user state seeded once, in the inbox


async def test_fanout_error_does_not_fail_processing(fake_db, monkeypatch):
    """The note is already written when fan-out runs — a fan-out explosion logs and the job
    still completes (Cloud Tasks must not retry paid AI work over a wall sync)."""
    async def boom(*a, **k):
        raise RuntimeError("wall sync down")

    monkeypatch.setattr(process, "fan_out_note", boom)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/films"})
    res = await process.process_job("j", DummyRequest())
    assert res["status"] == "completed"
    assert fake_db.docs[("jobs", "j")]["status"] == "completed"
    assert any(k[0] == "notes" for k in fake_db.docs)   # the note survived


async def test_reprocessing_does_not_duplicate_items(fake_db):
    """A Cloud Tasks retry that re-runs the pipeline converges: the stable m_{tmdb_id} item id
    upserts onto the same doc — one note, one watch item, user state untouched."""
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/films"})
    await process.process_job("j", DummyRequest())
    # Simulate the user promoting the item, then a redelivered task re-running the pipeline.
    fake_db.docs[("users/u/watch_items", "m_693134")]["watch_status"] = "to_watch"
    fake_db.docs[("jobs", "j")]["status"] = "pending"
    await process.process_job("j", DummyRequest())

    assert len([k for k in fake_db.docs if k[0] == "notes"]) == 1
    assert _watch_keys(fake_db) == [("users/u/watch_items", "m_693134")]  # no duplicate
    assert fake_db.docs[("users/u/watch_items", "m_693134")]["watch_status"] == "to_watch"
