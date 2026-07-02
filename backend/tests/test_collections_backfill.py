"""Smart-collection backfill: assign existing, unassigned notes into a newly created bucket."""
import services.collections as col


async def test_backfill_assigns_only_unassigned(fake_db):
    # Two notes with embeddings, one already in another bucket.
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "React hooks",
                                 "ai_summary": "", "embedding": [0.0], "collection_id": None})
    fake_db.seed("notes", "n2", {"user_id": "u", "title": "Vue guide",
                                 "ai_summary": "", "embedding": [0.0],
                                 "collection_id": "col_other"})
    fake_db.seed("notes", "n3", {"user_id": "u", "title": "no embedding yet",
                                 "ai_summary": ""})  # no embedding → not in vector results

    res = await col.assign_unassigned_to_collection(fake_db, "u", "col_sw", "Software", "dev tools")

    assert res["assigned"] == 1
    assert fake_db.docs[("notes", "n1")]["collection_id"] == "col_sw"   # swept in
    assert fake_db.docs[("notes", "n2")]["collection_id"] == "col_other"  # single-home preserved
    # The reassigned note is re-indexed with its new collection.
    idx = fake_db.docs.get(("search_index", "note-n1"))
    assert idx and idx["collection_id"] == "col_sw"


async def test_backfill_empty_name_is_noop(fake_db):
    res = await col.assign_unassigned_to_collection(fake_db, "u", "c", "", "")
    assert res["assigned"] == 0
