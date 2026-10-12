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
    # A configured WORKER_SECRET means the normal dispatch path (not the dev inline path)
    # runs by default; the inline-path test overrides this back to "".
    monkeypatch.setattr(settings, "WORKER_SECRET", "s3cret", raising=False)
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
    assert patch_ingest == []  # parked — nothing dispatched


async def test_ingest_route_enqueues_when_clear(fake_db, patch_ingest):
    res = await ingest_mod.ingest(
        FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u"
    )
    assert res.status == "pending"
    assert patch_ingest == [res.job_id]


async def test_enqueue_failure_marks_job_failed(fake_db, patch_ingest, monkeypatch):
    """A dispatch failure must not 500 or orphan a 'pending' job: the job goes
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
    """With no WORKER_SECRET (local dev) the worker runs inline instead of enqueuing."""
    monkeypatch.setattr(settings, "WORKER_SECRET", "", raising=False)
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
    assert patch_ingest == []          # nothing dispatched
    await asyncio.sleep(0)             # let the scheduled inline task run
    assert ran == [res.job_id]


# --- exact-duplicate capture -------------------------------------------------

async def test_duplicate_url_returns_existing_note_without_a_new_job(fake_db, patch_ingest):
    fake_db.seed("notes", "n-1", {"user_id": "u", "source_url": "https://example.com/x"})
    res = await ingest_mod.ingest(FakeRequest(b'{"url": "https://example.com/x?utm_source=a"}'),
                                  user_id="u")
    assert res.status == "completed" and res.note_id == "n-1"
    job = fake_db.docs[("jobs", res.job_id)]
    assert job["status"] == "completed" and job["note_id"] == "n-1"   # job watcher resolves
    assert job["destination"] == {"kind": "note", "note_id": "n-1"}
    assert patch_ingest == []                                         # nothing dispatched
    assert ("usage", f"u-{TODAY}") not in fake_db.docs                # no cap charged


async def test_other_users_note_or_bookmark_is_not_a_duplicate(fake_db, patch_ingest):
    fake_db.seed("notes", "n-1", {"user_id": "someone-else", "source_url": "https://example.com/x"})
    fake_db.seed("notes", "n-2", {"user_id": "u", "source_url": "https://example.com/x",
                                  "is_fallback": True})
    res = await ingest_mod.ingest(FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u")
    assert res.status == "pending" and patch_ingest == [res.job_id]


# --- deferred captures still charge the per-user daily cap ---------------------

async def test_deferred_saves_charge_user_daily_cap(fake_db, patch_ingest):
    cap = settings.DAILY_GLOBAL_NOTE_CAP
    fake_db.seed("system", f"usage-{TODAY}", {"note_count": cap})
    for i in range(settings.MAX_INGESTS_PER_USER_PER_DAY):
        res = await ingest_mod.ingest(FakeRequest(f'{{"url": "https://example.com/{i}"}}'.encode()),
                                      user_id="u")
        assert res.status == "deferred"
    with pytest.raises(HTTPException) as exc:
        await ingest_mod.ingest(FakeRequest(b'{"url": "https://example.com/over"}'), user_id="u")
    assert exc.value.status_code == 429
    assert fake_db.docs[("system", f"usage-{TODAY}")]["note_count"] == cap


# --- _existing_note: fallback bookmark must not hide the real note ------------

async def test_existing_note_skips_fallback_sorted_first(fake_db):
    url = "https://example.com/x"
    fake_db.seed("notes", "fb", {"user_id": "u", "source_url": url, "is_fallback": True})
    fake_db.seed("notes", "real", {"user_id": "u", "source_url": url})
    assert await ingest_mod._existing_note(fake_db, "u", url) == "real"


async def test_existing_note_only_fallback_is_a_miss(fake_db):
    url = "https://example.com/x"
    fake_db.seed("notes", "fb", {"user_id": "u", "source_url": url, "is_fallback": True})
    assert await ingest_mod._existing_note(fake_db, "u", url) is None


# --- audit C5/C14/C15/C18/C19 ----------------------------------------------

async def test_inflight_job_is_reused_not_duplicated(fake_db, patch_ingest):
    fake_db.seed("jobs", "j1", {"user_id": "u", "url": "https://example.com/x", "status": "processing"})
    res = await ingest_mod.ingest(FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u")
    assert res.job_id == "j1"
    assert res.status == "processing"
    assert [k for k in fake_db.docs if k[0] == "jobs"] == [("jobs", "j1")]


async def test_failed_job_does_not_block_new_job(fake_db, patch_ingest):
    fake_db.seed("jobs", "j1", {"user_id": "u", "url": "https://example.com/x", "status": "failed"})
    res = await ingest_mod.ingest(FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u")
    assert res.job_id != "j1"
    assert fake_db.docs[("jobs", res.job_id)]["submitted_url"] == "https://example.com/x"


async def test_existing_note_matches_submitted_url(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "source_url": "https://final.example/y",
                                 "submitted_url": "https://short.example/y"})
    assert await ingest_mod._existing_note(fake_db, "u", "https://short.example/y") == "n1"


async def test_fallback_duplicate_reextracts_in_place(fake_db, patch_ingest):
    fake_db.seed("notes", "fb", {"user_id": "u", "source_url": "https://example.com/x", "is_fallback": True})
    res = await ingest_mod.ingest(FakeRequest(b'{"url": "https://example.com/x"}'), user_id="u")
    assert fake_db.docs[("jobs", res.job_id)]["target_note_id"] == "fb"


async def test_copy_empty_and_malformed_url(fake_db):
    for body, msg in ((b'{"url": ""}', "Keeps saves links. Nothing to save here."),
                      (b'{"url": "https://"}', "That doesn't look like a complete link."),
                      (b'{"url": "ftp://x.com"}', "That doesn't look like a complete link.")):
        with pytest.raises(HTTPException) as exc:
            await ingest_mod.ingest(FakeRequest(body), user_id="u")
        assert exc.value.detail == msg


async def test_cap_messages_use_real_values(fake_db):
    fake_db.seed("usage", f"u-{TODAY}", {"ingest_count": settings.MAX_INGESTS_PER_USER_PER_DAY})
    with pytest.raises(HTTPException) as exc:
        await ingest_mod._enforce_cost_caps(fake_db, "u", skip_note_cap=True)
    assert str(settings.MAX_INGESTS_PER_USER_PER_DAY) in exc.value.detail
    assert "midnight UTC" in exc.value.detail


async def test_inflight_picks_newest_live_job(fake_db, patch_ingest):
    u = "https://example.com/x"
    fake_db.seed("jobs", "old", {"user_id": "u", "url": u, "status": "pending",
                                 "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc)})
    fake_db.seed("jobs", "new", {"user_id": "u", "url": u, "status": "deferred",
                                 "created_at": datetime(2026, 2, 1, tzinfo=timezone.utc)})
    for i in range(20):
        fake_db.seed("jobs", f"done{i}", {"user_id": "u", "url": u, "status": "completed"})
    assert await ingest_mod._inflight_job(fake_db, "u", u) == ("new", "deferred")
