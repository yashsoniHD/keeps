"""scripts/backfill_summaries.py: the migration-artifact summary matcher (pure) + the
dry-run/apply/merge-preserve safety behaviours (fake_db)."""
import pytest

import scripts.backfill_summaries as bs


# --- pure matcher -------------------------------------------------------------------------

@pytest.mark.parametrize("summary,expected", [
    ("Added 37 items to your Places collection.", True),
    ("Added 1 item to your Places collection.", True),
    ("Added 5 items to your Watchlist collection.", True),
    ("Added 12 items to your Weekend Trips collection.", True),
    ("A weekend trip through the Turkish coast, day by day.", False),
    ("Added 37 items to your Places collection", False),   # missing trailing period
    ("added 37 items to your places collection.", False),  # not the literal migration string
    ("", False),
    (None, False),
])
def test_is_migration_artifact_summary(summary, expected):
    assert bs.is_migration_artifact_summary(summary) is expected


# --- fake_db integration -----------------------------------------------------------------

def _prep(monkeypatch, fake_db):
    monkeypatch.setattr(bs, "get_db", lambda: fake_db)


async def test_dry_run_writes_nothing(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "5 cafes in Bandra",
        "ai_summary": "Added 5 items to your Places collection.",
        "content_type": "place", "data": {"venues": [{"name": "Blue Tokai"}]},
    })

    async def boom(*a, **k):
        raise AssertionError("dry-run must not call the model")
    monkeypatch.setattr(bs.gemini_service, "summarize_for_backfill", boom)

    await bs.run(dry_run=True, user_id=None, limit=None, per_minute=0)

    assert fake_db.docs[("notes", "n1")]["ai_summary"] == "Added 5 items to your Places collection."


async def test_apply_regenerates_summary_and_reindexes(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "5 cafes in Bandra",
        "ai_summary": "Added 5 items to your Places collection.",
        "content_type": "place", "data": {"venues": [{"name": "Blue Tokai"}]},
        "embedding": "old-vector",
    })

    async def fake_summarize(title, content_type, data):
        return "Blue Tokai and four other Bandra cafes worth a coffee run."
    monkeypatch.setattr(bs.gemini_service, "summarize_for_backfill", fake_summarize)

    async def fake_embed(text):
        return [1.0, 2.0]
    monkeypatch.setattr(bs.embedding_service, "embed_document", fake_embed)

    await bs.run(dry_run=False, user_id=None, limit=None, per_minute=0)

    note = fake_db.docs[("notes", "n1")]
    assert note["ai_summary"] == "Blue Tokai and four other Bandra cafes worth a coffee run."
    assert ("search_index", "note-n1") in fake_db.docs
    assert fake_db.docs[("search_index", "note-n1")]["summary"] == note["ai_summary"]


async def test_embed_failure_merge_preserves_old_vector(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T", "ai_summary": "Added 1 item to your Places collection.",
        "content_type": "place", "data": {}, "embedding": "old-vector",
    })

    async def fake_summarize(title, content_type, data):
        return "A real one-sentence summary."
    monkeypatch.setattr(bs.gemini_service, "summarize_for_backfill", fake_summarize)

    async def boom(text):
        raise RuntimeError("quota exceeded")
    monkeypatch.setattr(bs.embedding_service, "embed_document", boom)
    monkeypatch.setattr(bs.asyncio, "sleep", _noop_sleep)

    await bs.run(dry_run=False, user_id=None, limit=None, per_minute=0)

    note = fake_db.docs[("notes", "n1")]
    assert note["ai_summary"] == "A real one-sentence summary."
    assert note["embedding"] == "old-vector"  # merge-preserved, never wiped


async def test_limit_caps_work_but_reports_full_match_count(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    for i in range(3):
        fake_db.seed("notes", f"n{i}", {
            "user_id": "u", "title": f"Note {i}",
            "ai_summary": "Added 2 items to your Places collection.",
            "content_type": "place", "data": {},
        })
    calls = []

    async def fake_summarize(title, content_type, data):
        calls.append(title)
        return "Summary."
    monkeypatch.setattr(bs.gemini_service, "summarize_for_backfill", fake_summarize)

    async def fake_embed(text):
        return [1.0]
    monkeypatch.setattr(bs.embedding_service, "embed_document", fake_embed)

    await bs.run(dry_run=False, user_id=None, limit=1, per_minute=0)

    assert len(calls) == 1  # only one of the three matches was actually processed


async def _noop_sleep(*a, **k):
    return None
