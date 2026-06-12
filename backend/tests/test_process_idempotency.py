"""Worker idempotency: Cloud Tasks retries must never re-run paid AI work."""
import pytest

import routers.process as process


@pytest.fixture(autouse=True)
def patch_worker(fake_db, monkeypatch):
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)


class DummyRequest:
    headers = {}


async def test_completed_job_is_noop(fake_db):
    fake_db.seed("jobs", "job-1", {"status": "completed", "note_id": "note-9", "user_id": "u", "url": "https://x"})
    result = await process.process_job("job-1", DummyRequest())
    assert result == {"status": "completed", "note_id": "note-9"}
    # No status flips, no pipeline work — a retry of a done job costs nothing.
    assert fake_db.updates == []


async def test_missing_job_returns_200_shape(fake_db):
    """Cloud Tasks retries on 5xx; a missing job must return a normal payload instead."""
    result = await process.process_job("nope", DummyRequest())
    assert result == {"status": "missing"}


async def test_pipeline_failure_returns_200_shape(fake_db, monkeypatch):
    """A permanent pipeline exception never 5xxs (no Cloud Tasks retry storm) — it
    salvages a bookmark note and completes. Full ladder coverage: test_process_salvage."""
    fake_db.seed("jobs", "job-2", {"status": "pending", "user_id": "u", "url": "https://example.com/x"})

    async def boom(url):
        raise RuntimeError("scrape exploded")

    async def no_preview(url):
        return {}

    async def no_op_add(user_id, slug):
        return None

    monkeypatch.setattr(process.sources, "acquire", boom)
    monkeypatch.setattr(process, "_link_preview", no_preview)
    monkeypatch.setattr(process, "add_user_category", no_op_add)
    result = await process.process_job("job-2", DummyRequest())
    assert result["status"] == "completed"
    assert result.get("salvaged") is True
    assert fake_db.docs[("jobs", "job-2")]["status"] == "completed"
    assert "scrape exploded" in fake_db.docs[("jobs", "job-2")]["error"]
