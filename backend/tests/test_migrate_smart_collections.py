"""Data-migration script: prepping existing collections/notes for the smart-collections rework
(multi-membership collection_ids, backend-computed topic_embedding, pin-seeded members so the
first real rescore is purely additive). Same fake_db + monkeypatch pattern as test_migrations.py."""
import scripts.migrate_smart_collections as msc


def _prep(monkeypatch, fake_db):
    monkeypatch.setattr(msc, "get_db", lambda: fake_db)
    monkeypatch.setattr(msc, "EMBED_DELAY_S", 0)


# --- step (a): lift scalar collection_id onto collection_ids -------------------------------------

async def test_lifts_scalar_membership_onto_array_and_reindexes(fake_db, monkeypatch):
    """A note that already carries a stored embedding is safely reindexed via
    search_index.upsert_for_note, which reuses that vector — no new embed call."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T", "ai_summary": "", "collection_id": "c1",
        "embedding": [1.0, 0.0],
    })
    embed_calls = []

    async def spy_embed(text, *a, **k):
        embed_calls.append(text)
        return [0.0] * 8

    monkeypatch.setattr(msc.embedding_service, "embed_document", spy_embed)

    await msc.run(dry_run=False)

    assert fake_db.docs[("notes", "n1")]["collection_ids"] == ["c1"]
    idx = fake_db.docs.get(("search_index", "note-n1"))
    assert idx is not None
    assert idx["collection_ids"] == ["c1"]
    assert embed_calls == []  # the note's own stored vector was reused, not re-embedded


async def test_lift_does_not_embed_or_create_index_doc_for_note_with_no_embedding(fake_db, monkeypatch):
    """A note with no stored embedding must NOT be routed through search_index.upsert_for_note —
    that path falls back to a real, unpaced Vertex embed_document call per note, against a tiny
    QPM quota. With no pre-existing search_index doc to patch, nothing is written there; the note
    is still lifted onto collection_ids."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T", "ai_summary": "", "collection_id": "c1",
    })
    embed_calls = []

    async def spy_embed(text, *a, **k):
        embed_calls.append(text)
        return [0.0] * 8

    monkeypatch.setattr(msc.embedding_service, "embed_document", spy_embed)

    await msc.run(dry_run=False)

    assert fake_db.docs[("notes", "n1")]["collection_ids"] == ["c1"]
    assert ("search_index", "note-n1") not in fake_db.docs
    assert embed_calls == []


async def test_lift_patches_existing_search_index_doc_without_embedding(fake_db, monkeypatch):
    """A note with no stored embedding but an existing search_index doc gets that doc's
    collection fields patched directly — no embed call, no doc creation."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T", "ai_summary": "", "collection_id": "c1",
    })
    fake_db.seed("search_index", "note-n1", {
        "user_id": "u", "kind": "note", "ref_id": "n1",
        "collection_id": None, "collection_ids": [],
    })
    embed_calls = []

    async def spy_embed(text, *a, **k):
        embed_calls.append(text)
        return [0.0] * 8

    monkeypatch.setattr(msc.embedding_service, "embed_document", spy_embed)

    await msc.run(dry_run=False)

    idx = fake_db.docs[("search_index", "note-n1")]
    assert idx["collection_id"] == "c1"
    assert idx["collection_ids"] == ["c1"]
    assert embed_calls == []


async def test_lift_skips_notes_that_already_have_collection_ids(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T", "ai_summary": "",
        "collection_id": "c1", "collection_ids": ["c1", "c2"],
    })

    await msc.run(dry_run=False)

    # untouched — already migrated, first-writer-wins the existing array
    assert fake_db.docs[("notes", "n1")]["collection_ids"] == ["c1", "c2"]


async def test_lift_skips_notes_with_no_scalar_collection_id(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T", "ai_summary": ""})

    await msc.run(dry_run=False)

    assert "collection_ids" not in fake_db.docs[("notes", "n1")]


# --- step (b)/(c): topic embedding + override-list init + pin seeding ----------------------------

async def test_collection_gets_topic_embedding_and_initializes_override_lists(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {
        "user_id": "u", "name": "Software", "description": "dev tools and gadgets",
    })

    await msc.run(dry_run=False)

    col = fake_db.docs[("collections", "c1")]
    assert col["topic_query"]
    assert col["topic_embedding"] is not None
    assert col["excluded_note_ids"] == []


async def test_existing_excluded_note_ids_not_clobbered(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {
        "user_id": "u", "name": "Software", "description": "dev tools",
        "excluded_note_ids": ["already-excluded"],
    })

    await msc.run(dry_run=False)

    assert fake_db.docs[("collections", "c1")]["excluded_note_ids"] == ["already-excluded"]


async def test_pinned_seeded_with_current_members(fake_db, monkeypatch):
    """So the first real rescore can never silently drop a note the user already sees here."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": "dev"})
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T1", "ai_summary": "", "collection_ids": ["c1"],
    })
    fake_db.seed("notes", "n2", {
        "user_id": "u", "title": "T2", "ai_summary": "", "collection_ids": ["c2"],  # not a member
    })

    await msc.run(dry_run=False)

    assert fake_db.docs[("collections", "c1")]["pinned_note_ids"] == ["n1"]


async def test_pin_seeding_unions_not_duplicates_existing_pins(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {
        "user_id": "u", "name": "Software", "description": "dev",
        "pinned_note_ids": ["n0"],
    })
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T1", "ai_summary": "", "collection_ids": ["c1"],
    })

    await msc.run(dry_run=False)

    assert sorted(fake_db.docs[("collections", "c1")]["pinned_note_ids"]) == ["n0", "n1"]


async def test_lift_runs_before_member_scan_so_legacy_only_notes_get_pinned(fake_db, monkeypatch):
    """A note that only ever had the scalar collection_id (never migrated) must still end up
    pinned — step (a) lifts it onto collection_ids before step (c) scans membership."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": "dev"})
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T1", "ai_summary": "", "collection_id": "c1",
    })

    await msc.run(dry_run=False)

    assert fake_db.docs[("collections", "c1")]["pinned_note_ids"] == ["n1"]


# --- dry-run / idempotency -------------------------------------------------------------------------

async def test_dry_run_writes_nothing(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T", "ai_summary": "", "collection_id": "c1"})
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": "dev"})

    await msc.run(dry_run=True)

    assert "collection_ids" not in fake_db.docs[("notes", "n1")]
    assert "topic_embedding" not in fake_db.docs[("collections", "c1")]
    assert "pinned_note_ids" not in fake_db.docs[("collections", "c1")]


async def test_full_run_is_idempotent(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T", "ai_summary": "", "collection_id": "c1"})
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": "dev"})

    await msc.run(dry_run=False)
    first_note = dict(fake_db.docs[("notes", "n1")])
    first_col = dict(fake_db.docs[("collections", "c1")])

    await msc.run(dry_run=False)

    assert fake_db.docs[("notes", "n1")]["collection_ids"] == first_note["collection_ids"]
    assert fake_db.docs[("collections", "c1")]["pinned_note_ids"] == first_col["pinned_note_ids"]
    assert fake_db.docs[("collections", "c1")]["excluded_note_ids"] == first_col["excluded_note_ids"]


async def test_second_run_makes_no_embed_calls_once_topic_embedding_exists(fake_db, monkeypatch):
    """Rerun/resume safety: a collection that already has a topic_embedding (from a prior run)
    must not be re-embedded — _expand_topic_text/embed_query are skipped entirely for it."""
    _prep(monkeypatch, fake_db)
    fake_db.seed("collections", "c1", {"user_id": "u", "name": "Software", "description": "dev tools"})
    fake_db.seed("notes", "n1", {
        "user_id": "u", "title": "T1", "ai_summary": "", "collection_ids": ["c1"],
    })

    await msc.run(dry_run=False)  # first run: embeds once, seeds pins

    embed_calls = []

    async def spy_embed(text, *a, **k):
        embed_calls.append(text)
        return [0.0] * 8

    monkeypatch.setattr(msc.embedding_service, "embed_query", spy_embed)
    monkeypatch.setattr(msc.embedding_service, "embed_document", spy_embed)

    await msc.run(dry_run=False)

    assert embed_calls == []
