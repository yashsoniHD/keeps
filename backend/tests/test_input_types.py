"""Input breadth: capture works for typed text, not just URLs.

Two layers:
  - /api/ingest (JSON) accepts the right shapes and rejects the wrong ones, writing a
    uniform job doc.
  - the worker builds the correct ContentBundle per input_type and writes a note with
    no source link for non-URL captures.
"""
import json

import pytest

import routers.ingest as ingest
import routers.process as process
from models.note import IngestRequest, NoteExtraction


# ----------------------- ingest boundary -----------------------

class FakeRequest:
    def __init__(self, payload=None, headers=None):
        self._body = json.dumps(payload).encode() if payload is not None else b""
        self.headers = headers or {}

    async def body(self):
        return self._body


@pytest.fixture(autouse=True)
def patch_ingest(fake_db, monkeypatch):
    async def no_caps(db, user_id, **kw):
        return None

    async def public_ok(url):
        return None

    monkeypatch.setattr(ingest, "get_db", lambda: fake_db)
    monkeypatch.setattr(ingest, "_enforce_cost_caps", no_caps)
    monkeypatch.setattr(ingest, "assert_public_url_async", public_ok)
    monkeypatch.setattr(ingest, "enqueue_process_job", lambda job_id: None)


def only_job(fake_db):
    jobs = [v for (coll, _), v in fake_db.docs.items() if coll == "jobs"]
    assert len(jobs) == 1
    return jobs[0]


async def test_text_ingest_creates_text_job(fake_db):
    res = await ingest.ingest(FakeRequest({"input_type": "text", "text": "Remember to call the dentist",
                                           "title": "Todo"}), user_id="u-1")
    assert res.status == "pending"
    job = only_job(fake_db)
    assert job["input_type"] == "text"
    assert job["text"] == "Remember to call the dentist"
    assert job["title"] == "Todo"
    assert job["url"] is None


async def test_text_ingest_defaults_to_ai(fake_db):
    await ingest.ingest(FakeRequest({"input_type": "text", "text": "structure me"}), user_id="u-1")
    assert only_job(fake_db)["process_ai"] is True


async def test_save_as_is_sets_process_ai_false(fake_db):
    """An explicit process_ai=false opts the typed note out of Gemini structuring."""
    await ingest.ingest(
        FakeRequest({"input_type": "text", "text": "raw thought, keep verbatim", "process_ai": False}),
        user_id="u-1",
    )
    job = only_job(fake_db)
    assert job["process_ai"] is False
    assert job["input_type"] == "text"


async def test_save_as_is_does_not_promote_a_url_body(fake_db):
    """A link in a save-as-is note stays a verbatim text note — the user opted out of fetching it."""
    await ingest.ingest(
        FakeRequest({"input_type": "text", "text": "https://example.com/x", "process_ai": False}),
        user_id="u-1",
    )
    job = only_job(fake_db)
    assert job["input_type"] == "text"  # NOT promoted to a url capture
    assert job["text"] == "https://example.com/x"


async def test_binary_input_types_rejected(fake_db):
    from fastapi import HTTPException
    for t in ("image", "pdf", "voice", "video"):
        with pytest.raises(HTTPException) as exc:
            await ingest.ingest(FakeRequest({"input_type": t}), user_id="u-1")
        assert exc.value.status_code == 400


async def test_empty_text_rejected(fake_db):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await ingest.ingest(FakeRequest({"input_type": "text", "text": "   "}), user_id="u-1")
    assert exc.value.status_code == 400


async def test_url_ingest_unchanged(fake_db):
    res = await ingest.ingest(FakeRequest({"url": "https://example.com/x"}), user_id="u-1")
    assert res.status == "pending"
    job = only_job(fake_db)
    assert job["input_type"] == "url"
    assert job["url"] == "https://example.com/x"


async def test_text_that_is_a_url_is_promoted(fake_db):
    """A 'text' share whose body is just a link runs the full URL pipeline, not a raw note."""
    await ingest.ingest(FakeRequest({"input_type": "text", "text": "https://example.com/post"}), user_id="u-1")
    job = only_job(fake_db)
    assert job["input_type"] == "url"
    assert job["url"] == "https://example.com/post"


class DummyRequest:
    headers: dict = {}


@pytest.fixture
def capture_pipeline(fake_db, monkeypatch):
    """Wire the worker so we can inspect the ContentBundle that reaches extraction and the
    note that gets written. Returns a dict the test reads after process_job runs."""
    captured: dict = {}

    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)

    async def no_categories(user_id):
        return []

    async def no_op(*a, **k):
        return None

    async def no_embed(*a, **k):
        return None

    async def fake_classify(url, bundle, existing, note_hint=None):
        captured["assign_bundle"] = bundle
        return "summary"

    async def fake_extract(url, bundle, content_type, note_hint=None, **_):
        captured["bundle"] = bundle
        captured["url"] = url
        return NoteExtraction(
            content_type=content_type, title="A title", ai_summary="A summary",
            cover_image_prompt="",
            data={"sections": [{"heading": "H", "items": ["a sufficiently long item of content"]}]},
        )

    monkeypatch.setattr(process, "get_user_categories", no_categories)
    monkeypatch.setattr(process, "add_user_category", no_op)
    monkeypatch.setattr(process, "add_user_source", no_op)
    monkeypatch.setattr(process, "_note_embedding", no_embed)
    monkeypatch.setattr(process.gemini_service, "classify", fake_classify)
    monkeypatch.setattr(process.gemini_service, "extract_async", fake_extract)
    return captured


def the_note(fake_db):
    notes = [v for (coll, _), v in fake_db.docs.items() if coll == "notes"]
    assert len(notes) == 1
    return notes[0]


async def test_worker_text_input(fake_db, capture_pipeline):
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u-1", "input_type": "text",
                               "text": "Buy oat milk and figs", "title": "Groceries"})
    await process.process_job("j", DummyRequest())
    bundle = capture_pipeline["bundle"]
    assert bundle.kind == "text"
    assert bundle.text == "Buy oat milk and figs"
    assert bundle.strategy == "text_input"
    note = the_note(fake_db)
    assert note["input_type"] == "text"
    assert note["source_url"] == ""           # no web source → UI hides the link
    assert note["source_domain"] == ""


async def test_worker_save_as_is_skips_gemini(fake_db, capture_pipeline):
    """process_ai=False saves the text verbatim: no categorize/extract call, body kept as-is."""
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u-1", "input_type": "text",
                               "text": "First line\nmore detail here", "process_ai": False})
    await process.process_job("j", DummyRequest())
    assert "bundle" not in capture_pipeline  # extract_async was never invoked
    note = the_note(fake_db)
    assert note["content_type"] == "note"
    assert note["template"] == "note"
    assert note["data"]["body"] == "First line\nmore detail here"
    assert note["title"] == "First line"        # derived from the first line
    assert note["source_url"] == ""


async def test_worker_url_still_uses_resolver(fake_db, capture_pipeline, monkeypatch):
    from models.note import ContentBundle

    async def fake_acquire(url):
        return ContentBundle(kind="text", text="scraped article body", strategy="generic",
                             metadata={"title": "Post"})

    monkeypatch.setattr(process.sources, "acquire", fake_acquire)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u-1", "input_type": "url",
                               "url": "https://example.com/post"})
    await process.process_job("j", DummyRequest())
    assert capture_pipeline["bundle"].strategy == "generic"
    note = the_note(fake_db)
    assert note["input_type"] == "url"
    assert note["source_domain"] == "example.com"
    assert note["source_url"] == "https://example.com/post"
