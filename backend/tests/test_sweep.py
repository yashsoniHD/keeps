"""Sweep route: re-dispatch stale pending/processing jobs, fail hopeless ones, and reach
the static routes (regression: /process/{job_id} used to shadow /process/drain-deferred)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.process as process
from config import settings


def ago(seconds):
    return datetime.now(timezone.utc) - timedelta(seconds=seconds)


@pytest.fixture
def dispatched(fake_db, monkeypatch):
    monkeypatch.setattr(process, "get_db", lambda: fake_db)
    monkeypatch.setattr(settings, "WORKER_SECRET", "w", raising=False)
    monkeypatch.setattr(settings, "CRON_SECRET", "c", raising=False)
    calls = []
    monkeypatch.setattr(process, "enqueue_process_job",
                        lambda job_id, path="/api/process": calls.append((job_id, path)))
    return calls


def job(status, age, **kw):
    return {"status": status, "user_id": "u", "updated_at": ago(age),
            "created_at": ago(age), "attempt_count": 1, **kw}


async def test_reclaim_stale(fake_db, dispatched):
    fake_db.seed("jobs", "stale-pending", job("pending", process.PENDING_STALE_SECONDS + 30))
    fake_db.seed("jobs", "fresh-pending", job("pending", 10))
    fake_db.seed("jobs", "stale-proc", job("processing", process.CLAIM_STALE_SECONDS + 30))
    fake_db.seed("jobs", "fresh-proc", job("processing", 30))
    fake_db.seed("jobs", "done", job("completed", 99999))
    fake_db.seed("jobs", "agent", job("pending", 600, kind="agent_task"))

    n = await process._reclaim_stale(fake_db)

    assert n == 3
    assert sorted(dispatched) == [("agent", "/api/process-agent"),
                                  ("stale-pending", "/api/process"),
                                  ("stale-proc", "/api/process")]


async def test_old_or_exhausted_jobs_are_failed_not_dispatched(fake_db, dispatched):
    fake_db.seed("jobs", "ancient", job("pending", process.SWEEP_GIVE_UP_S + 60))
    fake_db.seed("jobs", "tried", job("pending", 600, attempt_count=process.SWEEP_MAX_ATTEMPTS))

    await process._reclaim_stale(fake_db)

    assert dispatched == []
    assert fake_db.docs[("jobs", "ancient")]["status"] == "failed"
    assert fake_db.docs[("jobs", "tried")]["status"] == "failed"


async def test_dispatch_error_does_not_stop_sweep(fake_db, dispatched, monkeypatch):
    fake_db.seed("jobs", "a", job("pending", 600))
    fake_db.seed("jobs", "b", job("pending", 600))

    def flaky(job_id, path="/api/process"):
        if job_id == "a":
            raise RuntimeError("boom")
        dispatched.append(job_id)

    monkeypatch.setattr(process, "enqueue_process_job", flaky)
    assert await process._reclaim_stale(fake_db) == 1
    assert dispatched == ["b"]


def _client():
    app = FastAPI()
    app.include_router(process.router, prefix="/api")
    return TestClient(app)


def test_sweep_route_is_reachable_and_auth_gated(fake_db, dispatched):
    fake_db.seed("jobs", "stale", job("pending", 600))
    c = _client()
    assert c.get("/api/process/sweep").status_code == 403
    r = c.get("/api/process/sweep", headers={"Authorization": "Bearer c"})
    assert r.status_code == 200, r.text
    assert r.json()["redispatched"] == 1
    assert dispatched == [("stale", "/api/process")]


def test_drain_deferred_is_not_shadowed_by_job_id_route(fake_db, dispatched):
    """Regression: POST /process/drain-deferred used to run process_job('drain-deferred')."""
    r = _client().post("/api/process/drain-deferred", headers={"X-Worker-Secret": "w"})
    assert r.status_code == 200, r.text
    assert "drained" in r.json()
    assert r.json() != {"status": "missing"}


def _note_count(fake_db):
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return fake_db.docs.get(("system", f"usage-{today}"), {}).get("note_count", 0)


async def test_drain_failure_mid_way_charges_dispatched_and_sweep_still_reclaims(
        fake_db, dispatched, monkeypatch):
    for i in range(3):
        fake_db.seed("jobs", f"d{i}", {"status": "deferred", "user_id": "u"})
    fake_db.seed("jobs", "stale", job("pending", 600))

    def flaky(job_id, path="/api/process"):
        if job_id == "d1":
            raise RuntimeError("boom")
        dispatched.append((job_id, path))

    monkeypatch.setattr(process, "enqueue_process_job", flaky)
    r = _client().get("/api/process/sweep", headers={"Authorization": "Bearer c"})
    assert r.status_code == 200, r.text
    assert r.json()["drained"] == 2
    assert _note_count(fake_db) == 2                      # only dispatched jobs are charged
    assert ("stale", "/api/process") in dispatched         # reclaim ran after the drain


async def test_sweep_reclaims_even_if_drain_raises(fake_db, dispatched, monkeypatch):
    async def boom(db):
        raise RuntimeError("drain exploded")

    monkeypatch.setattr(process, "_drain_deferred", boom)
    fake_db.seed("jobs", "stale", job("pending", 600))
    r = _client().get("/api/process/sweep", headers={"Authorization": "Bearer c"})
    assert r.status_code == 200 and r.json()["redispatched"] == 1


async def test_drain_stops_at_batch_cap(fake_db, dispatched, monkeypatch):
    monkeypatch.setattr(process, "DRAIN_BATCH", 3)
    for i in range(5):
        fake_db.seed("jobs", f"d{i}", {"status": "deferred", "user_id": "u"})
    out = await process._drain_deferred(fake_db)
    assert out["drained"] == 3 and len(dispatched) == 3
    assert _note_count(fake_db) == 3
