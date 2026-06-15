"""Deep async agent tasks: job creation, enqueue routing, and the per-user daily cap."""
import pytest
from fastapi import HTTPException

import routers.ask as ask_mod
from config import settings
from datetime import datetime, timezone
from models.ask import AskRequest

TODAY = datetime.now(timezone.utc).strftime("%Y%m%d")


class FakeTransaction:
    def __init__(self, db):
        self._db = db

    def set(self, ref, data, merge=False):
        base = self._db.docs.get(ref._key, {}) if merge else {}
        self._db.docs[ref._key] = {**base, **data}


@pytest.fixture(autouse=True)
def patch_deep(fake_db, monkeypatch):
    fake_db.transaction = lambda: FakeTransaction(fake_db)
    monkeypatch.setattr(ask_mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(ask_mod.fs, "async_transactional", lambda f: f)
    calls = []
    monkeypatch.setattr(ask_mod, "enqueue_process_job",
                        lambda job_id, path="/api/process": calls.append((job_id, path)))
    return calls


async def test_deep_creates_agent_job_and_enqueues(fake_db, patch_deep):
    res = await ask_mod.ask_deep(
        AskRequest(question="compile a PRD from all my startup notes",
                   selected_note_ids=["a", "b"]),
        user_id="u",
    )
    assert res.status == "pending" and res.job_id
    job = fake_db.docs[("jobs", res.job_id)]
    assert job["kind"] == "agent_task"
    assert job["agent_request"]["question"].startswith("compile a PRD")
    assert job["agent_request"]["selected_note_ids"] == ["a", "b"]
    # Routed to the deep worker, not the URL pipeline.
    assert patch_deep == [(res.job_id, "/api/process-agent")]


async def test_deep_daily_cap_blocks(fake_db, patch_deep):
    fake_db.seed("usage", f"u-{TODAY}", {"deep_count": settings.MAX_DEEP_TASKS_PER_USER_PER_DAY})
    with pytest.raises(HTTPException) as exc:
        await ask_mod.ask_deep(AskRequest(question="x"), user_id="u")
    assert exc.value.status_code == 429
    assert patch_deep == []  # nothing enqueued when capped
