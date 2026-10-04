"""POST /api/notes/{note_id}/reextract + the worker's target_note_id path.

Re-extract re-runs the full pipeline over a note's original source_url and overwrites the note
in place (preserving created_at). Owner-only; counts against the daily ingest cap. A now-dead
source fails the job WITHOUT clobbering the existing note.
"""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import routers.ingest as ingest_mod
import routers.notes as notes_mod
import routers.process as process_mod
from config import settings
from models.note import ContentBundle, NoteExtraction

OLD = datetime(2024, 1, 1, tzinfo=timezone.utc)


class DummyRequest:
    headers = {}


# --- endpoint ---------------------------------------------------------------

@pytest.fixture
def patch_endpoint(fake_db, monkeypatch):
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)
    # A configured WORKER_SECRET keeps _create_job on the dispatch path (not dev inline).
    monkeypatch.setattr(settings, "WORKER_SECRET", "s3cret", raising=False)
    enqueued: list[str] = []
    monkeypatch.setattr(ingest_mod, "enqueue_process_job", lambda jid: enqueued.append(jid))

    async def _touch(uid, **kw):
        return None
    monkeypatch.setattr(ingest_mod, "touch_user_activity", _touch)
    return enqueued


async def test_reextract_missing_note_404(fake_db, patch_endpoint):
    with pytest.raises(HTTPException) as exc:
        await notes_mod.reextract_note("nope", user_id="u")
    assert exc.value.status_code == 404


async def test_reextract_rejects_non_owner(fake_db, patch_endpoint):
    fake_db.seed("notes", "n1", {"user_id": "owner", "source_url": "https://x.com/a"})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.reextract_note("n1", user_id="intruder")
    assert exc.value.status_code == 403
    assert not [k for k in fake_db.docs if k[0] == "jobs"]  # no job created for a non-owner


async def test_reextract_without_source_url_400(fake_db, patch_endpoint):
    # Typed / uploaded / AI notes carry no re-fetchable web source.
    fake_db.seed("notes", "n1", {"user_id": "u", "source_url": ""})
    with pytest.raises(HTTPException) as exc:
        await notes_mod.reextract_note("n1", user_id="u")
    assert exc.value.status_code == 400


async def test_reextract_job_carries_target_note_id(fake_db, patch_endpoint):
    fake_db.seed("notes", "n1", {"user_id": "u", "source_url": "https://x.com/a", "source": "web"})
    res = await notes_mod.reextract_note("n1", user_id="u")

    job = fake_db.docs[("jobs", res["job_id"])]
    assert job["target_note_id"] == "n1"
    assert job["url"] == "https://x.com/a"
    assert job["input_type"] == "url"
    assert job["status"] == "pending"
    assert patch_endpoint == [res["job_id"]]  # dispatched to the worker


async def test_reextract_exempt_from_lifetime_note_cap(fake_db, patch_endpoint, monkeypatch):
    # Re-extract overwrites in place, so a user at MAX_NOTES_PER_USER can still heal a note.
    monkeypatch.setattr(settings, "MAX_NOTES_PER_USER", 1)
    fake_db.seed("notes", "n1", {"user_id": "u", "source_url": "https://x.com/a", "source": "web"})
    res = await notes_mod.reextract_note("n1", user_id="u")
    assert fake_db.docs[("jobs", res["job_id"])]["target_note_id"] == "n1"

    # A plain ingest for the same at-cap user is still rejected.
    with pytest.raises(HTTPException) as exc:
        await ingest_mod._enforce_cost_caps(fake_db, "u")
    assert exc.value.status_code == 429


# --- worker (target_note_id) ------------------------------------------------

@pytest.fixture
def wire_worker(fake_db, monkeypatch):
    """Happy-path worker wiring (mirrors test_process_fanout) for the overwrite path."""
    monkeypatch.setattr(process_mod, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process_mod, "get_db", lambda: fake_db)

    async def _noop(*a, **k):
        return None

    async def cats(uid):
        return []

    async def classify(url, bundle, existing, note_hint=None):
        return "summary"

    async def extract(url, bundle, ct, note_hint=None, **_):
        return NoteExtraction(content_type=ct, title="Re-extracted title",
                              ai_summary="Fresh summary with plenty of detail.",
                              cover_image_prompt="",
                              data={"tldr": "the whole point", "keyPoints": ["a", "b"]})

    async def acquire(url):
        return ContentBundle(kind="text", text="x" * 80, metadata={"platform": "web"},
                             strategy="web_scrape")

    async def fake_enrich(user_id, ct, d, cover):
        return d, None

    monkeypatch.setattr(process_mod, "get_user_categories", cats)
    monkeypatch.setattr(process_mod, "add_user_category", _noop)
    monkeypatch.setattr(process_mod, "add_user_source", _noop)
    monkeypatch.setattr(process_mod, "touch_user_activity", _noop)
    monkeypatch.setattr(process_mod, "_note_embedding", _noop)
    monkeypatch.setattr(process_mod, "enrich_note_data", fake_enrich)
    monkeypatch.setattr(process_mod.gemini_service, "classify", classify)
    monkeypatch.setattr(process_mod.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process_mod.sources, "acquire", acquire)
    return fake_db


async def test_worker_overwrites_target_note_and_preserves_created_at(fake_db, wire_worker):
    fake_db.seed("notes", "existing", {
        "user_id": "u", "content_type": "recipe", "title": "Old title",
        "source_url": "https://x.com/a", "created_at": OLD,
    })
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://x.com/a", "target_note_id": "existing"})

    res = await process_mod.process_job("j", DummyRequest())
    assert res["status"] == "completed"
    assert res["note_id"] == "existing"

    note = fake_db.docs[("notes", "existing")]
    assert note["title"] == "Re-extracted title"   # overwritten in place
    assert note["content_type"] == "summary"
    assert note["created_at"] == OLD               # preserved across the re-extract
    assert note["updated_at"] != OLD               # refreshed
    # No orphan note minted under the stable-id path — the target id is the only note doc.
    assert [k for k in fake_db.docs if k[0] == "notes"] == [("notes", "existing")]


async def test_worker_drops_removed_owner_flags_on_overwrite(fake_db, wire_worker):
    """Favorites/pins/public links were removed: a re-extract no longer carries them over."""
    fake_db.seed("notes", "existing", {
        "user_id": "u", "content_type": "recipe", "title": "Old title",
        "source_url": "https://x.com/a", "created_at": OLD,
        "is_favorite": True, "is_public": True, "pinned_at": OLD,
    })
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://x.com/a", "target_note_id": "existing"})

    await process_mod.process_job("j", DummyRequest())
    note = fake_db.docs[("notes", "existing")]
    assert note["title"] == "Re-extracted title" and note["created_at"] == OLD
    assert not {"is_favorite", "is_public", "pinned_at"} & set(note)


async def test_worker_does_not_fabricate_owner_flags_when_absent(fake_db, wire_worker):
    """A note that was never favorited/pinned/shared must not gain those flags from the
    overwrite — absence on the old doc means absence on the new one."""
    fake_db.seed("notes", "existing", {
        "user_id": "u", "content_type": "recipe", "title": "Old title",
        "source_url": "https://x.com/a", "created_at": OLD,
    })
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://x.com/a", "target_note_id": "existing"})

    await process_mod.process_job("j", DummyRequest())
    note = fake_db.docs[("notes", "existing")]
    assert "is_favorite" not in note
    assert "is_public" not in note
    assert "pinned_at" not in note


async def test_reextract_salvage_does_not_clobber_target_note(fake_db, monkeypatch):
    """A dead source on a re-extract must fail the job and leave the note untouched — never
    salvage it into a bookmark, and never mint a salvage doc."""
    monkeypatch.setattr(process_mod, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process_mod, "get_db", lambda: fake_db)

    async def boom(url):
        raise RuntimeError("source is gone")
    monkeypatch.setattr(process_mod.sources, "acquire", boom)

    fake_db.seed("notes", "existing", {
        "user_id": "u", "content_type": "place", "title": "10 Bandra cafes",
        "source_url": "https://instagram.com/p/dead/", "created_at": OLD,
        "data": {"venues": [{"name": "Blue Tokai"}]},
    })
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://instagram.com/p/dead/",
                               "target_note_id": "existing"})

    res = await process_mod.process_job("j", DummyRequest())
    assert res["status"] == "failed"
    assert fake_db.docs[("jobs", "j")]["status"] == "failed"

    note = fake_db.docs[("notes", "existing")]
    assert note["title"] == "10 Bandra cafes"       # untouched
    assert note["content_type"] == "place"
    assert note.get("is_fallback") is None          # not turned into a salvage bookmark
    assert [k for k in fake_db.docs if k[0] == "notes"] == [("notes", "existing")]


async def test_reextract_unreachable_source_does_not_clobber(fake_db, monkeypatch):
    """The unreachable-source short-circuit (metadata_only bundle) on a re-extract also fails
    without clobbering the note."""
    monkeypatch.setattr(process_mod, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process_mod, "get_db", lambda: fake_db)

    async def unreachable(url):
        return ContentBundle(kind="metadata_only", metadata={"title": "x"},
                             strategy="unreachable")
    monkeypatch.setattr(process_mod.sources, "acquire", unreachable)

    async def no_sleep(d):  # the unreachable source is retried in-process first
        pass
    monkeypatch.setattr(process_mod.asyncio, "sleep", no_sleep)

    fake_db.seed("notes", "existing", {
        "user_id": "u", "content_type": "recipe", "title": "Good recipe",
        "source_url": "https://x.com/dead", "created_at": OLD,
    })
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://x.com/dead", "target_note_id": "existing"})

    res = await process_mod.process_job("j", DummyRequest())
    assert res["status"] == "failed"
    assert fake_db.docs[("notes", "existing")]["title"] == "Good recipe"  # untouched
    assert [k for k in fake_db.docs if k[0] == "notes"] == [("notes", "existing")]
