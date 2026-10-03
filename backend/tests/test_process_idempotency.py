"""Worker idempotency: retries must never re-run paid AI work — neither a
sequential redelivery of a completed job nor a concurrent duplicate delivery."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

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
    """A missing job must return a normal payload, not a 5xx (which would trigger a retry)."""
    result = await process.process_job("nope", DummyRequest())
    assert result == {"status": "missing"}


async def test_pipeline_failure_returns_200_shape(fake_db, monkeypatch):
    """A permanent pipeline exception never 5xxs (no retry storm) — it
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


# --- concurrent duplicate delivery (transactional claim) ---------------------

async def test_in_flight_job_rejects_duplicate_delivery(fake_db):
    """A job actively claimed by another delivery must 409 (the dispatcher drops it),
    never run the pipeline a second time."""
    fake_db.seed("jobs", "job-3", {"status": "processing", "user_id": "u", "url": "https://x",
                                   "updated_at": datetime.now(timezone.utc)})
    with pytest.raises(HTTPException) as exc:
        await process.process_job("job-3", DummyRequest())
    assert exc.value.status_code == 409


async def test_stale_processing_claim_is_reclaimed(fake_db, monkeypatch):
    """A crashed run leaves status=processing with an old heartbeat — a later redelivery
    must be able to claim and finish the job instead of parking it forever."""
    stale = datetime.now(timezone.utc) - timedelta(seconds=process.CLAIM_STALE_SECONDS + 60)
    fake_db.seed("jobs", "job-4", {"status": "processing", "user_id": "u",
                                   "url": "https://example.com/x", "updated_at": stale})

    async def boom(url):
        raise RuntimeError("still exploding")

    async def no_preview(url):
        return {}

    async def no_op_add(user_id, slug):
        return None

    monkeypatch.setattr(process.sources, "acquire", boom)
    monkeypatch.setattr(process, "_link_preview", no_preview)
    monkeypatch.setattr(process, "add_user_category", no_op_add)
    result = await process.process_job("job-4", DummyRequest())
    assert result["status"] == "completed"
    assert fake_db.docs[("jobs", "job-4")]["status"] == "completed"


async def test_overlapping_deliveries_run_pipeline_once(fake_db, monkeypatch):
    """Two overlapping deliveries of one task: exactly one runs the (paid) pipeline and
    exactly one note is written; the loser 409s."""
    fake_db.seed("jobs", "job-5", {"status": "pending", "user_id": "u",
                                   "url": "https://example.com/x"})
    started, release = asyncio.Event(), asyncio.Event()
    acquire_calls: list[str] = []

    async def slow_acquire(url):
        acquire_calls.append(url)
        started.set()
        await release.wait()
        raise RuntimeError("boom")  # finish via the salvage path — pipeline internals don't matter

    async def no_preview(url):
        return {}

    async def no_op_add(user_id, slug):
        return None

    monkeypatch.setattr(process.sources, "acquire", slow_acquire)
    monkeypatch.setattr(process, "_link_preview", no_preview)
    monkeypatch.setattr(process, "add_user_category", no_op_add)

    winner = asyncio.create_task(process.process_job("job-5", DummyRequest()))
    await started.wait()  # winner holds the claim, mid-pipeline
    with pytest.raises(HTTPException) as exc:
        await process.process_job("job-5", DummyRequest())
    assert exc.value.status_code == 409
    release.set()
    result = await winner
    assert result["status"] == "completed"
    assert acquire_calls == ["https://example.com/x"]  # pipeline ran exactly once
    note_docs = [k for k in fake_db.docs if k[0] == "notes"]
    assert len(note_docs) == 1


async def test_note_id_is_deterministic_per_job(fake_db):
    """Even if a duplicate ever slipped past the claim, both runs converge on one doc id."""
    assert process._stable_id("note", "job-9") == process._stable_id("note", "job-9")
    assert process._stable_id("note", "job-9") != process._stable_id("note", "job-8")
    assert process._stable_id("note", "job-9") != process._stable_id("salvage", "job-9")
