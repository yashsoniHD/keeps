"""Phase 5 data-migration scripts: the safety-critical behaviours.

Covers the drop-miniapp-notes gate (never delete a note without a materialized item) and the
collections backfill (first-writer-wins single-home).
"""
import scripts.backfill_collections as bc
import scripts.migrate_drop_miniapp_notes as drop


async def test_drop_only_deletes_notes_with_an_item(fake_db, monkeypatch):
    monkeypatch.setattr(drop, "get_db", lambda: fake_db)
    # A recipe note WITH a materialized recipe_item that references it → deletable.
    fake_db.seed("notes", "n_has_item", {"user_id": "u", "content_type": "recipe", "title": "Dal"})
    fake_db.docs[("users/u/recipe_items", "r_1")] = {
        "user_id": "u", "title": "Dal", "source_note_ids": ["n_has_item"],
    }
    # A recipe note whose fan-out never produced an item → must be KEPT (record of the capture).
    fake_db.seed("notes", "n_no_item", {"user_id": "u", "content_type": "recipe", "title": "Vague"})
    # A plain article note → never touched (not a mini-app family).
    fake_db.seed("notes", "n_article", {"user_id": "u", "content_type": "article", "title": "Essay"})

    await drop.run(dry_run=False)

    assert ("notes", "n_has_item") not in fake_db.docs   # deleted (item exists)
    assert ("notes", "n_no_item") in fake_db.docs        # kept (no item — never lose it)
    assert ("notes", "n_article") in fake_db.docs        # kept (not a mini-app note)


async def test_drop_dry_run_deletes_nothing(fake_db, monkeypatch):
    monkeypatch.setattr(drop, "get_db", lambda: fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "movie", "title": "Dune"})
    fake_db.docs[("users/u/watch_items", "m_1")] = {
        "user_id": "u", "title": "Dune", "source_note_ids": ["n1"],
    }
    await drop.run(dry_run=True)
    assert ("notes", "n1") in fake_db.docs  # dry-run never writes


async def test_collections_backfill_first_writer_wins(fake_db, monkeypatch):
    monkeypatch.setattr(bc, "get_db", lambda: fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "React", "ai_summary": ""})
    fake_db.seed("notes", "n2", {"user_id": "u", "title": "Vue", "ai_summary": "",
                                 "collection_id": "col_existing"})
    fake_db.seed("collections", "col_sw", {"user_id": "u", "name": "Software",
                                           "note_ids": ["n1", "n2"]})

    await bc.run(dry_run=False)

    assert fake_db.docs[("notes", "n1")]["collection_id"] == "col_sw"       # newly assigned
    assert fake_db.docs[("notes", "n2")]["collection_id"] == "col_existing" # kept (single-home)
    # The reassigned note is mirrored into search_index with its bucket.
    assert fake_db.docs[("search_index", "note-n1")]["collection_id"] == "col_sw"
