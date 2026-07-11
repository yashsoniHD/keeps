"""scripts/reconcile_stale_items.py: heal mini-app items orphaned before the PATCH-time
reconcile existed — stale sole-source items are deleted (with their search_index doc),
multi-source items are trimmed, healthy items and dry-runs touch nothing."""
import scripts.reconcile_stale_items as rs


def _prep(monkeypatch, fake_db):
    monkeypatch.setattr(rs, "get_db", lambda: fake_db)


async def test_stale_sole_source_item_is_deleted(fake_db, monkeypatch):
    """The reported bug: a note recategorised product -> software before the fix left its
    wish_item behind. The sweep deletes the item and its search_index doc."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "software"})
    fake_db.seed("users/u/wish_items", "p1",
                 {"user_id": "u", "title": "Widget", "source_note_ids": ["n1"]})
    fake_db.seed("search_index", "wish-p1", {"user_id": "u", "kind": "wish", "ref_id": "p1"})

    await rs.run(dry_run=False, uid="u")

    assert ("users/u/wish_items", "p1") not in fake_db.docs
    assert ("search_index", "wish-p1") not in fake_db.docs


async def test_multi_source_item_is_trimmed_not_deleted(fake_db, monkeypatch):
    """An item still backed by one valid product note keeps living — only the recategorised
    and the deleted note ids are dropped from source_note_ids."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "software"})  # recategorised
    fake_db.seed("notes", "n2", {"user_id": "u", "content_type": "product"})   # still valid
    # "gone" has no note doc at all — a deleted note also stops counting as a source.
    fake_db.seed("users/u/wish_items", "p1",
                 {"user_id": "u", "title": "Widget", "source_note_ids": ["n1", "gone", "n2"]})

    await rs.run(dry_run=False, uid="u")

    assert fake_db.docs[("users/u/wish_items", "p1")]["source_note_ids"] == ["n2"]


async def test_matching_item_is_untouched(fake_db, monkeypatch):
    """A healthy item (its note still exists and still matches the family) is a no-op —
    and so is a source-less manual add (empty source_note_ids)."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "movie"})
    fake_db.seed("users/u/watch_items", "m_1",
                 {"user_id": "u", "title": "Dune", "source_note_ids": ["n1"]})
    fake_db.seed("users/u/watch_items", "m_2",
                 {"user_id": "u", "title": "Manual add", "source_note_ids": []})

    await rs.run(dry_run=False, uid="u")

    assert fake_db.docs[("users/u/watch_items", "m_1")]["source_note_ids"] == ["n1"]
    assert ("users/u/watch_items", "m_2") in fake_db.docs
    assert fake_db.updates == []  # nothing was written at all


async def test_dry_run_writes_nothing(fake_db, monkeypatch):
    """Default mode only reports: the stale item, its index doc, and its sources all survive."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "software"})
    fake_db.seed("notes", "n2", {"user_id": "u", "content_type": "product"})
    fake_db.seed("users/u/wish_items", "p1",
                 {"user_id": "u", "title": "Widget", "source_note_ids": ["n1"]})
    fake_db.seed("users/u/wish_items", "p2",
                 {"user_id": "u", "title": "Kept", "source_note_ids": ["n1", "n2"]})
    fake_db.seed("search_index", "wish-p1", {"user_id": "u", "kind": "wish", "ref_id": "p1"})

    await rs.run(dry_run=True, uid="u")

    assert fake_db.docs[("users/u/wish_items", "p1")]["source_note_ids"] == ["n1"]
    assert fake_db.docs[("users/u/wish_items", "p2")]["source_note_ids"] == ["n1", "n2"]
    assert ("search_index", "wish-p1") in fake_db.docs
    assert fake_db.updates == []


async def test_all_users_sweeps_every_family_via_collection_group(fake_db, monkeypatch):
    """uid=None scans collection-group style across users, and every family table row is live
    (a stale trip item for another user is healed in the same run)."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u1", "content_type": "software"})
    fake_db.seed("notes", "n2", {"user_id": "u2", "content_type": "article"})  # left the trip family
    fake_db.seed("users/u1/wish_items", "p1",
                 {"user_id": "u1", "title": "Widget", "source_note_ids": ["n1"]})
    fake_db.seed("users/u2/trip_items", "t1",
                 {"user_id": "u2", "title": "Goa", "source_note_ids": ["n2"]})

    await rs.run(dry_run=False, uid=None)

    assert ("users/u1/wish_items", "p1") not in fake_db.docs
    assert ("users/u2/trip_items", "t1") not in fake_db.docs
