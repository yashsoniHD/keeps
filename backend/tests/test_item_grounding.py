"""Clip AI grounding is notes-only after the notes-first collapse.

fetch_notes_by_ids resolves note ids in order, skips foreign/missing docs, and quietly drops
legacy prefixed item ids ('recipe-r_1') left in pre-migration conversations. candidate_pool
merges recency + vector coverage without double-counting.
"""
import services.note_retrieval as nr


async def test_fetch_resolves_notes_in_order(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "An article",
                                 "ai_summary": "s", "data": {}})
    fake_db.seed("notes", "n2", {"user_id": "u", "title": "A recipe",
                                 "ai_summary": "s", "data": {}})
    out = await nr.fetch_notes_by_ids(fake_db, "u", ["n2", "n1"])
    assert [x["id"] for x in out] == ["n2", "n1"]


async def test_fetch_skips_foreign_missing_and_legacy_item_ids(fake_db):
    fake_db.seed("notes", "n_theirs", {"user_id": "someone_else", "title": "X"})
    out = await nr.fetch_notes_by_ids(fake_db, "u", ["n_theirs", "n_missing", "recipe-r_1"])
    assert out == []  # foreign owner, missing doc, and legacy prefixed id all drop out


async def test_candidate_pool_merges_recent_and_vector_without_duplicates(fake_db):
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Note one",
                                 "ai_summary": "s", "created_at": 2, "embedding": [0.0]})
    fake_db.seed("notes", "n2", {"user_id": "u", "title": "Note two",
                                 "ai_summary": "s", "created_at": 1})  # no embedding
    pool = await nr.candidate_pool(fake_db, "u", "what should I cook")
    ids = [p["id"] for p in pool]
    assert set(ids) == {"n1", "n2"}
    assert len(ids) == 2  # n1 appears in both recency and vector shortlists — deduped
