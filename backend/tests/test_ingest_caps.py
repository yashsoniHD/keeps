"""Ingest cost caps.

Per-user caps are an abuse backstop and hard-reject with 429. The *global* daily cap must
NOT reject — it defers the capture (status "deferred", nothing enqueued) so a brand-new user
isn't errored on their first save during a launch spike. The parked capture is drained later.
"""
import asyncio

import pytest
from fastapi import HTTPException

import routers.ingest as ingest_mod
from config import settings
from datetime import datetime, timezone

TODAY = datetime.now(timezone.utc).strftime("%Y%m%d")


class FakeTransaction:
    def __init__(self, db):
        self._db = db

    def set(self, ref, data, merge=False):
        base = self._db.docs.get(ref._key, {}) if merge else {}
        self._db.docs[ref._key] = {**base, **data}


class FakeRequest:
    """Minimal Starlette-Request stand-in: just .headers.get + await .body()."""
    def __init__(self, body: bytes, headers=None):
        self._body = body
        self.headers = headers or {}

    async def body(self):
        return self._body


@pytest.fixture(autouse=True)
def patch_ingest(fake_db, monkeypatch):
    fake_db.transaction = lambda: FakeTransaction(fake_db)
    monkeypatch.setattr(ingest_mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(ingest_mod.fs, "async_transactional", lambda f: f)
    # A configured SA email means the normal Cloud Tasks enqueue path (not the dev inline path)
    # runs by default; the inline-path test overrides this back to "".
    monkeypatch.setattr(settings, "CLOUD_TASKS_SA_EMAIL", "sa@example.com")
    calls = []
    monkeypatch.setattr(ingest_mod, "enqueue_process_job", lambda job_id: calls.append(job_id))

    async def _ok(url):  # SSRF guard is I/O — stub to "public"
        return None

    monkeypatch.setattr(ingest_mod, "assert_public_url_async", _ok)

    async def _touch(uid, **kw):  # activity write is I/O — stub
        return None

    monkeypatch.setattr(ingest_mod, "touch_user_activity", _touch)
    return calls


# --- _enforce_cost_caps (the unit) -----------------------------------------

async def test_clean_user_proceeds_and_bumps(fake_db):
    deferred = await ingest_mod._enforce_cost_caps(fake_db, "u")
    assert deferred is False
    assert fake_db.docs[("usage", f"u-{TODAY}")]["ingest_count"] == 1
    assert fake_db.docs[("system", f"usage-{TODAY}")]["note_count"] == 1


async def test_per_user_daily_cap_raises_429(fake_db):
    fake_db.seed("usage", f"u-{TODAY}",
                 {"ingest_count": settings.MAX_INGESTS_PER_USER_PER_DAY})
    with pytest.raises(HTTPException) as exc:
        await ingest_mod._enforce_cost_caps(fake_db, "u")
    assert exc.value.status_code == 429


async def test_per_user_note_cap_raises_429(fake_db):
    for i in range(settings.MAX_NOTES_PER_USER):
        fake_db.seed("notes", f"n{i}", {"user_id": "u"})
    with pytest.raises(HTTPException) as exc:
        await ingest_mod._enforce_cost_caps(fake_db, "u")
    assert exc.value.status_code == 429


async def test_fallback_notes_dont_count_against_note_cap(fake_db):
    # One under the cap in *real* notes, then pile on fallback bookmarks: the salvage docs
    # must not push the user over MAX_NOTES_PER_USER, so the capture still proceeds.
    for i in range(settings.MAX_NOTES_PER_USER - 1):
        fake_db.seed("notes", f"n{i}", {"user_id": "u"})
    for i in range(5):
        fake_db.seed("notes", f"fb{i}", {"user_id": "u", "is_fallback": True})
    deferred = await ingest_mod._enforce_cost_caps(fake_db, "u")
    assert deferred is False  # 499 real notes < 500 cap; the 5 fallbacks don't count


async def test_global_cap_defers_not_rejects(fake_db):
    # A fresh user with the global kill-switch tripped: deferred, not 429, and no budget burned.
    fake_db.seed("system", f"usage-{TODAY}", {"note_count": settings.DAILY_GLOBAL_NOTE_CAP})
    deferred = await ingest_mod._enforce_cost_caps(fake_db, "fresh-user")
    assert deferred is True
    # The global counter is untouched (a deferred capture consumes no budget today).
    assert fake_db.docs[("system", f"usage-{TODAY}")]["note_count"] == settings.DAILY_GLOBAL_NOTE_CAP


# --- ingest() route -------------------------------------------------------

async def test_ingest_route_defers_on_global_cap(fake_db, patch_ingest):
    fake_db.seed("system", f"usage-{TODAY}", {"note_count": settings.DAILY_GLOBAL_NOTE_CAP})
    res = await ingest_mod.ingest(
        FakeRequest(b'{"url": "https://example.com/x"}'), user_id="fresh-user"
    )
    assert res.status == "deferred"
    assert fake_db.docs[("jobs", res.job_id)]["status"] == "deferred"
    assert patch_ingest == []  # parked — nothing enqueued to Cloud Tasks


async def test_ingest_route_enqueues_when_clear(fake_db, patch_ingest):
    res = await ingest_mod.ingest(
        FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u"
    )
    assert res.status == "pending"
    assert patch_ingest == [res.job_id]


async def test_enqueue_failure_marks_job_failed(fake_db, patch_ingest, monkeypatch):
    """A Cloud Tasks enqueue failure must not 500 or orphan a 'pending' job: the job goes
    terminal ('failed') so the client stops showing an eternal 'Saving…' card."""
    def boom(job_id):
        raise RuntimeError("cloud tasks unavailable")

    monkeypatch.setattr(ingest_mod, "enqueue_process_job", boom)

    res = await ingest_mod.ingest(
        FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u"
    )
    assert res.status == "failed"
    job = fake_db.docs[("jobs", res.job_id)]
    assert job["status"] == "failed"
    assert job["error"]  # a human-readable message, not a stack trace


async def test_empty_sa_email_runs_inline(fake_db, patch_ingest, monkeypatch):
    """With no Cloud Tasks SA (local dev) the worker runs inline instead of enqueuing."""
    monkeypatch.setattr(settings, "CLOUD_TASKS_SA_EMAIL", "")
    ran = []

    async def fake_process(job_id):
        ran.append(job_id)
        return {"status": "completed"}

    import routers.process as process_mod
    monkeypatch.setattr(process_mod, "_process_job", fake_process)

    res = await ingest_mod.ingest(
        FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u"
    )
    assert res.status == "pending"
    assert patch_ingest == []          # nothing enqueued to Cloud Tasks
    await asyncio.sleep(0)             # let the scheduled inline task run
    assert ran == [res.job_id]
