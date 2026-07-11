"""scripts/backfill_missing_embeddings.py: dry-run reporting, notes-fix, and the
search_index-reuses-the-note-vector-for-free path."""
import scripts.backfill_missing_embeddings as bme


def _prep(monkeypatch, fake_db):
    monkeypatch.setattr(bme, "get_db", lambda: fake_db)


async def test_dry_run_reports_without_writing(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Turkey trip", "ai_summary": "8 days."})

    async def boom(text):
        raise AssertionError("dry-run must not call the embedding service")
    monkeypatch.setattr(bme.embedding_service, "embed_document", boom)

    await bme.run(dry_run=True, user_id=None, per_minute=0)

    assert "embedding" not in fake_db.docs[("notes", "n1")]


async def test_apply_embeds_note_and_reindexes(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "An eight day Turkey itinerary",
                                 "ai_summary": "A full loop from Istanbul to Cappadocia."})

    async def fake_embed(text):
        return [0.1, 0.2, 0.3]
    monkeypatch.setattr(bme.embedding_service, "embed_document", fake_embed)

    await bme.run(dry_run=False, user_id=None, per_minute=0)

    note = fake_db.docs[("notes", "n1")]
    assert note.get("embedding") is not None
    idx = fake_db.docs[("search_index", "note-n1")]
    assert idx.get("embedding") is not None


async def test_notes_already_embedded_are_left_alone(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "X", "embedding": "already-there"})

    async def boom(text):
        raise AssertionError("must not re-embed a note that already has a vector")
    monkeypatch.setattr(bme.embedding_service, "embed_document", boom)

    await bme.run(dry_run=False, user_id=None, per_minute=0)
    assert fake_db.docs[("notes", "n1")]["embedding"] == "already-there"


async def test_search_index_reuses_freshly_fixed_note_vector_for_free(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Turkey trip", "ai_summary": "8 days."})
    fake_db.seed("search_index", "note-n1", {
        "user_id": "u", "kind": "note", "ref_id": "n1", "title": "Turkey trip",
        "summary": "8 days.",
    })
    embed_calls = []

    async def fake_embed(text):
        embed_calls.append(text)
        return [0.5]
    monkeypatch.setattr(bme.embedding_service, "embed_document", fake_embed)

    await bme.run(dry_run=False, user_id=None, per_minute=0)

    # One embed call fixes both the note and the search_index entry — no second call spent.
    assert len(embed_calls) == 1
    assert fake_db.docs[("search_index", "note-n1")]["embedding"] is not None


async def test_search_index_place_entry_with_no_note_embeds_itself(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("search_index", "place-p1", {
        "user_id": "u", "kind": "place", "ref_id": "p1", "title": "Blue Tokai", "summary": "Cafe",
    })

    async def fake_embed(text):
        return [0.9]
    monkeypatch.setattr(bme.embedding_service, "embed_document", fake_embed)

    await bme.run(dry_run=False, user_id=None, per_minute=0)
    assert fake_db.docs[("search_index", "place-p1")]["embedding"] is not None


async def test_per_user_filter(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u1", "title": "A"})
    fake_db.seed("notes", "n2", {"user_id": "u2", "title": "B"})

    async def fake_embed(text):
        return [1.0]
    monkeypatch.setattr(bme.embedding_service, "embed_document", fake_embed)

    await bme.run(dry_run=False, user_id="u1", per_minute=0)

    assert fake_db.docs[("notes", "n1")].get("embedding") is not None
    assert "embedding" not in fake_db.docs[("notes", "n2")]
