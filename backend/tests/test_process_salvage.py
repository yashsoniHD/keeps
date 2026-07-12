"""Salvage ladder: a capture always produces a note — unless the URL is blocked.

Transient failures re-raise (Cloud Tasks retries) below the attempt cap; everything
else salvages a minimal bookmark note instead of marking the job failed.
"""
import httpx
import pytest
from fastapi import HTTPException
from google.genai import errors as genai_errors

import routers.process as process
from models.note import ContentBundle, NoteExtraction
from services.net_guard import BlockedURLError


class DummyRequest:
    headers = {}


BUNDLE = ContentBundle(
    kind="text",
    text="A long enough piece of scraped article text for the pipeline.",
    metadata={"title": "A Great Post", "platform": "web"},
    images=["https://cdn.example.com/cover.jpg"],
    strategy="web_scrape",
)


@pytest.fixture(autouse=True)
def patch_worker(fake_db, monkeypatch):
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)

    async def no_categories(user_id):
        return []

    async def no_collections(user_id):
        return []

    async def no_op_add(user_id, slug):
        return None

    async def no_preview(url):
        return {}  # salvage must not hit the network in tests

    monkeypatch.setattr(process, "get_user_categories", no_categories)
    monkeypatch.setattr(process, "get_user_collections", no_collections)
    monkeypatch.setattr(process, "add_user_category", no_op_add)
    monkeypatch.setattr(process, "_link_preview", no_preview)


def seed_job(fake_db, attempts=0):
    fake_db.seed("jobs", "job-1", {
        "status": "pending", "user_id": "u-1",
        "url": "https://example.com/post", "attempt_count": attempts,
    })


def patch_pipeline(monkeypatch, *, acquire_exc=None, extract_exc=None, extraction=None):
    """Wires a pipeline where acquisition succeeds (unless acquire_exc) and
    extraction raises extract_exc or returns extraction."""
    async def fake_acquire(url):
        if acquire_exc:
            raise acquire_exc
        return BUNDLE

    monkeypatch.setattr(process.sources, "acquire", fake_acquire)

    async def fake_classify(url, bundle, existing, note_hint=None):
        return "summary"

    async def fake_extract(url, bundle, content_type, note_hint=None):
        if extract_exc:
            raise extract_exc
        return extraction

    monkeypatch.setattr(process.gemini_service, "classify", fake_classify)
    monkeypatch.setattr(process.gemini_service, "extract_async", fake_extract)


def salvaged_notes(fake_db):
    return [doc for (coll, _), doc in fake_db.docs.items() if coll == "notes"]


async def test_extraction_failure_salvages_bookmark(fake_db, monkeypatch):
    """A permanent extraction failure produces a bookmark note, not a failed job."""
    seed_job(fake_db)
    patch_pipeline(monkeypatch, extract_exc=RuntimeError("model exploded"))

    result = await process.process_job("job-1", DummyRequest())

    assert result["status"] == "completed"
    assert result.get("salvaged") is True
    job = fake_db.docs[("jobs", "job-1")]
    assert job["status"] == "completed"
    assert job["note_id"] == result["note_id"]
    notes = salvaged_notes(fake_db)
    assert len(notes) == 1
    note = notes[0]
    assert note["content_type"] == "bookmark"
    assert note["is_fallback"] is True
    assert note["acquisition"] == "salvage"
    assert note["title"] == "A Great Post"           # from the acquired bundle
    assert note["cover_image_url"] == "https://cdn.example.com/cover.jpg"
    assert note["data"]["facts"][0] == {"label": "Source", "value": "example.com"}


async def test_empty_extraction_salvages(fake_db, monkeypatch):
    """The 'suspiciously short data' guard routes to salvage, not failed."""
    seed_job(fake_db)
    patch_pipeline(monkeypatch, extraction=NoteExtraction(
        content_type="summary", title="t", ai_summary="s",
        cover_image_prompt="", data={}))

    result = await process.process_job("job-1", DummyRequest())

    assert result["status"] == "completed"
    assert salvaged_notes(fake_db)[0]["content_type"] == "bookmark"


async def test_transient_below_cap_reraises_for_retry(fake_db, monkeypatch):
    """Network-ish failures on early attempts → 500 so Cloud Tasks retries. No note."""
    seed_job(fake_db, attempts=0)
    patch_pipeline(monkeypatch, extract_exc=httpx.ConnectTimeout("connect timed out"))

    with pytest.raises(HTTPException) as exc:
        await process.process_job("job-1", DummyRequest())

    assert exc.value.status_code == 500
    job = fake_db.docs[("jobs", "job-1")]
    assert job["status"] == "pending"                # still in-flight for the feed
    assert salvaged_notes(fake_db) == []


async def test_transient_at_cap_salvages(fake_db, monkeypatch):
    """The third transient failure stops retrying and salvages a bookmark note."""
    seed_job(fake_db, attempts=process.MAX_TRANSIENT_ATTEMPTS - 1)
    patch_pipeline(monkeypatch, extract_exc=httpx.ConnectTimeout("connect timed out"))

    result = await process.process_job("job-1", DummyRequest())

    assert result["status"] == "completed"
    assert result.get("salvaged") is True
    assert salvaged_notes(fake_db)[0]["content_type"] == "bookmark"


UNREACHABLE = ContentBundle(
    kind="metadata_only",
    text="URL: https://example.com/post (content could not be retrieved)",
    metadata={"title": "example.com", "platform": "example.com"},
    strategy="unreachable",
)


async def test_unreachable_source_salvages_without_extracting(fake_db, monkeypatch):
    """When every strategy fails the resolver returns a metadata-only stub. The pipeline must
    salvage an honest bookmark rather than feed the stub to Gemini (which fabricates a full
    note from the URL slug). classify/extract must NOT run, and nothing is fanned out."""
    seed_job(fake_db)

    async def unreachable(url):
        return UNREACHABLE

    monkeypatch.setattr(process.sources, "acquire", unreachable)

    classify_calls, extract_calls, fan_calls = [], [], []

    async def spy_classify(*a, **k):
        classify_calls.append(a)
        return "summary"

    async def spy_extract(*a, **k):
        extract_calls.append(a)
        return NoteExtraction(content_type="summary", title="t", ai_summary="s",
                              cover_image_prompt="", data={"body": "x" * 60})

    async def spy_fan(user_id, note_id, note_doc):
        fan_calls.append(note_id)

    monkeypatch.setattr(process.gemini_service, "classify", spy_classify)
    monkeypatch.setattr(process.gemini_service, "extract_async", spy_extract)
    monkeypatch.setattr(process, "fan_out_note", spy_fan)

    result = await process.process_job("job-1", DummyRequest())

    assert result["status"] == "completed"
    assert result.get("salvaged") is True
    note = salvaged_notes(fake_db)[0]
    assert note["is_fallback"] is True
    assert note["content_type"] == "bookmark"
    assert note["template"] == "bookmark"
    assert note["acquisition"] == "salvage"
    assert extract_calls == []   # (a) Gemini extraction never ran on the fabrication path
    assert classify_calls == []
    assert fan_calls == []        # (b) a salvaged bookmark is not fanned out to mini-apps


async def test_blocked_url_still_hard_fails(fake_db, monkeypatch):
    """SSRF blocks stay permanent: failed job, no note, no retry."""
    seed_job(fake_db)

    async def blocked(url):
        raise BlockedURLError("Blocked non-public address: 10.0.0.1")

    monkeypatch.setattr(process.sources, "acquire", blocked)

    result = await process.process_job("job-1", DummyRequest())

    assert result["status"] == "failed"
    assert fake_db.docs[("jobs", "job-1")]["status"] == "failed"
    assert salvaged_notes(fake_db) == []


async def test_salvage_write_failure_marks_failed(fake_db, monkeypatch):
    """Only when even the salvage Firestore write fails does the job go failed."""
    seed_job(fake_db)
    patch_pipeline(monkeypatch, extract_exc=RuntimeError("model exploded"))

    async def broken_salvage(db, **kwargs):
        raise OSError("firestore down")

    monkeypatch.setattr(process, "_salvage_note", broken_salvage)

    result = await process.process_job("job-1", DummyRequest())

    assert result["status"] == "failed"
    assert fake_db.docs[("jobs", "job-1")]["status"] == "failed"


def test_is_transient_classification():
    assert process._is_transient(genai_errors.APIError(503, {"error": {"message": "x"}}))
    assert process._is_transient(genai_errors.APIError(429, {"error": {"message": "x"}}))
    assert not process._is_transient(genai_errors.APIError(404, {"error": {"message": "x"}}))
    assert process._is_transient(httpx.ConnectError("dns broke"))
    assert process._is_transient(httpx.ReadTimeout("slow origin"))
    assert not process._is_transient(ValueError("empty extraction"))
