"""Input breadth: capture works for text / image / pdf, not just URLs.

Two layers:
  - /api/ingest (JSON) and /api/ingest/upload (multipart) accept the right shapes and
    reject the wrong ones, writing a uniform job doc.
  - the worker builds the correct ContentBundle per input_type and writes a note with
    no source link for non-URL captures.
"""
import json

import pytest

import routers.ingest as ingest
import routers.process as process
from models.note import IngestRequest, NoteExtraction


# ----------------------- ingest boundary (JSON + multipart) -----------------------

class FakeRequest:
    def __init__(self, payload=None, headers=None):
        self._body = json.dumps(payload).encode() if payload is not None else b""
        self.headers = headers or {}

    async def body(self):
        return self._body


class FakeUpload:
    def __init__(self, data: bytes, content_type: str):
        self._data = data
        self.content_type = content_type

    async def read(self):
        return self._data


@pytest.fixture(autouse=True)
def patch_ingest(fake_db, monkeypatch):
    async def no_caps(db, user_id):
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


async def test_upload_image_creates_image_job(fake_db, monkeypatch):
    monkeypatch.setattr(ingest.uploads, "bucket_for", lambda t: "covers-bucket")

    async def fake_store(input_type, data, mime):
        return "gs://covers-bucket/uploads/images/x.png", "https://storage.googleapis.com/covers-bucket/uploads/images/x.png"

    monkeypatch.setattr(ingest.uploads, "store_upload", fake_store)

    res = await ingest.ingest_upload(
        file=FakeUpload(b"\x89PNG fake bytes", "image/png"),
        input_type="image", title="Recipe screenshot", source="upload", note_hint=None,
        user_id="u-1",
    )
    assert res.status == "pending"
    job = only_job(fake_db)
    assert job["input_type"] == "image"
    assert job["media_gcs_uri"].startswith("gs://covers-bucket/")
    assert job["media_mime"] == "image/png"
    assert job["media_cover_url"].startswith("https://")
    assert job["title"] == "Recipe screenshot"


async def test_upload_rejects_unsupported_mime(fake_db, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(ingest.uploads, "bucket_for", lambda t: "b")
    with pytest.raises(HTTPException) as exc:
        await ingest.ingest_upload(file=FakeUpload(b"hi", "text/plain"),
                                   input_type="image", title=None, source="upload",
                                   note_hint=None, user_id="u-1")
    assert exc.value.status_code == 415


async def test_upload_rejects_oversized(fake_db, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(ingest.uploads, "bucket_for", lambda t: "b")
    monkeypatch.setattr(ingest.settings, "MAX_UPLOAD_MB", 0)  # nothing fits
    with pytest.raises(HTTPException) as exc:
        await ingest.ingest_upload(file=FakeUpload(b"x" * 1024, "image/png"),
                                   input_type="image", title=None, source="upload",
                                   note_hint=None, user_id="u-1")
    assert exc.value.status_code == 413


async def test_upload_voice_creates_voice_job(fake_db, monkeypatch):
    monkeypatch.setattr(ingest.uploads, "bucket_for", lambda t: "media-bucket")

    async def fake_store(input_type, data, mime):
        # Voice goes to the private media bucket — no public cover URL.
        return "gs://media-bucket/uploads/audio/x.m4a", None

    monkeypatch.setattr(ingest.uploads, "store_upload", fake_store)

    res = await ingest.ingest_upload(
        file=FakeUpload(b"fake audio bytes", "audio/mp4"),
        input_type="voice", title=None, source="upload", note_hint=None,
        user_id="u-1",
    )
    assert res.status == "pending"
    job = only_job(fake_db)
    assert job["input_type"] == "voice"
    assert job["media_gcs_uri"].startswith("gs://media-bucket/")
    assert job["media_mime"] == "audio/mp4"
    assert job["media_cover_url"] is None


async def test_upload_rejects_unsupported_voice_mime(fake_db, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(ingest.uploads, "bucket_for", lambda t: "b")
    with pytest.raises(HTTPException) as exc:
        await ingest.ingest_upload(file=FakeUpload(b"x", "audio/x-aiff"),
                                   input_type="voice", title=None, source="upload",
                                   note_hint=None, user_id="u-1")
    assert exc.value.status_code == 415


async def test_upload_503_when_bucket_unconfigured(fake_db, monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(ingest.uploads, "bucket_for", lambda t: None)
    with pytest.raises(HTTPException) as exc:
        await ingest.ingest_upload(file=FakeUpload(b"x", "image/png"),
                                   input_type="image", title=None, source="upload",
                                   note_hint=None, user_id="u-1")
    assert exc.value.status_code == 503


# ----------------------- worker: bundle construction per type -----------------------

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

    async def fake_assign(url, bundle, existing, note_hint=None):
        captured["assign_bundle"] = bundle
        return "summary"

    async def fake_extract(url, bundle, content_type, note_hint=None):
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
    monkeypatch.setattr(process.gemini_service, "assign_category", fake_assign)
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


async def test_worker_image_input(fake_db, capture_pipeline):
    cover = "https://storage.googleapis.com/covers/uploads/images/x.png"
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u-1", "input_type": "image",
                               "media_gcs_uri": "gs://covers/uploads/images/x.png",
                               "media_mime": "image/png", "media_cover_url": cover,
                               "title": "Screenshot"})
    await process.process_job("j", DummyRequest())
    bundle = capture_pipeline["bundle"]
    assert bundle.kind == "image"
    assert bundle.media_uri == "gs://covers/uploads/images/x.png"
    assert bundle.media_mime == "image/png"
    note = the_note(fake_db)
    assert note["input_type"] == "image"
    assert note["cover_image_url"] == cover    # the uploaded image is its own cover
    assert note["source_url"] == ""


async def test_worker_pdf_input(fake_db, capture_pipeline):
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u-1", "input_type": "pdf",
                               "media_gcs_uri": "gs://media/uploads/docs/x.pdf",
                               "media_mime": "application/pdf", "title": "Paper"})
    await process.process_job("j", DummyRequest())
    bundle = capture_pipeline["bundle"]
    assert bundle.kind == "document"
    assert bundle.media_uri == "gs://media/uploads/docs/x.pdf"
    assert bundle.media_mime == "application/pdf"
    assert the_note(fake_db)["input_type"] == "pdf"


async def test_worker_voice_input(fake_db, capture_pipeline):
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u-1", "input_type": "voice",
                               "media_gcs_uri": "gs://media/uploads/audio/x.m4a",
                               "media_mime": "audio/mp4", "title": "Voice note"})
    await process.process_job("j", DummyRequest())
    bundle = capture_pipeline["bundle"]
    assert bundle.kind == "document"          # audio rides the same gs:// FileData path
    assert bundle.media_uri == "gs://media/uploads/audio/x.m4a"
    assert bundle.media_mime == "audio/mp4"
    assert bundle.strategy == "voice_upload"
    note = the_note(fake_db)
    assert note["input_type"] == "voice"
    assert note["source_url"] == ""           # no web source for a recording


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
