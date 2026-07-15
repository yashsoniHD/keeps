"""scripts/backfill_content_embeddings.py: re-embed pre-v2 notes under the title+summary+data
recipe, dry-run safety, v2-skip, and the pass-2 free reuse of a note's stored vector."""
import scripts.backfill_content_embeddings as bce
from services.embeddings import EMBED_TEXT_VERSION


def _prep(monkeypatch, fake_db):
    monkeypatch.setattr(bce, "get_db", lambda: fake_db)


async def test_dry_run_reports_without_writing_or_embedding(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Turkey trip",
                                 "ai_summary": "8 days.", "data": {"days": 8}})

    async def boom(text):
        raise AssertionError("dry-run must not call the embedding service")
    monkeypatch.setattr(bce.embedding_service, "embed_document", boom)

    await bce.run(dry_run=True, user_id=None, per_minute=0)

    assert "embedding_version" not in fake_db.docs[("notes", "n1")]
    assert "embedding" not in fake_db.docs[("notes", "n1")]


async def test_v2_notes_are_skipped(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "X",
                                 "embedding": "current", "embedding_version": EMBED_TEXT_VERSION})

    async def boom(text):
        raise AssertionError("must not re-embed a note already at the current version")
    monkeypatch.setattr(bce.embedding_service, "embed_document", boom)

    await bce.run(dry_run=False, user_id=None, per_minute=0)
    assert fake_db.docs[("notes", "n1")]["embedding"] == "current"


async def test_v1_note_gets_vector_version_and_search_index(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    # A pre-v2 note (no embedding_version) with content only in its data.
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Butter chicken",
                                 "ai_summary": "Curry.",
                                 "data": {"ingredients": ["garam masala"]}})
    fake_db.seed("search_index", "note-n1", {
        "user_id": "u", "kind": "note", "ref_id": "n1", "title": "Butter chicken",
        "summary": "Curry.",
    })
    embed_calls = []

    async def fake_embed(text):
        embed_calls.append(text)
        return [0.1, 0.2, 0.3]
    monkeypatch.setattr(bce.embedding_service, "embed_document", fake_embed)

    await bce.run(dry_run=False, user_id=None, per_minute=0)

    note = fake_db.docs[("notes", "n1")]
    assert note["embedding_version"] == EMBED_TEXT_VERSION
    assert note["embedding"] is not None
    idx = fake_db.docs[("search_index", "note-n1")]
    assert idx["embedding"] is not None
    assert idx["embedding_version"] == EMBED_TEXT_VERSION
    # The re-embed reads the note's data, not just its title/summary.
    assert len(embed_calls) == 1
    assert "garam masala" in embed_calls[0]


async def test_pass2_reuses_note_vector_without_embedding(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    # Note is already v2; only its index entry lags (no embedding_version).
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T", "ai_summary": "S",
                                 "embedding": "note-vec",
                                 "embedding_version": EMBED_TEXT_VERSION})
    fake_db.seed("search_index", "note-n1", {
        "user_id": "u", "kind": "note", "ref_id": "n1", "title": "T", "summary": "S",
    })

    async def boom(text):
        raise AssertionError("pass 2 must not spend an embed call")
    monkeypatch.setattr(bce.embedding_service, "embed_document", boom)

    await bce.run(dry_run=False, user_id=None, per_minute=0)

    idx = fake_db.docs[("search_index", "note-n1")]
    assert idx["embedding"] == "note-vec"
    assert idx["embedding_version"] == EMBED_TEXT_VERSION


async def test_per_user_filter(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u1", "title": "A", "data": {"x": 1}})
    fake_db.seed("notes", "n2", {"user_id": "u2", "title": "B", "data": {"x": 2}})

    async def fake_embed(text):
        return [1.0]
    monkeypatch.setattr(bce.embedding_service, "embed_document", fake_embed)

    await bce.run(dry_run=False, user_id="u1", per_minute=0)

    assert fake_db.docs[("notes", "n1")].get("embedding_version") == EMBED_TEXT_VERSION
    assert "embedding_version" not in fake_db.docs[("notes", "n2")]
