"""Data-migration scripts: the safety-critical behaviours.

Covers the items→notes migration (the notes-first collapse: regrouping, merge-onto-live-note,
idempotency, dry-run safety, composed-note ref healing) and the collections backfill
(first-writer-wins single-home).
"""
import scripts.backfill_collections as bc
import scripts.migrate_items_to_notes as mig


def _prep(monkeypatch, fake_db):
    monkeypatch.setattr(mig, "get_db", lambda: fake_db)
    monkeypatch.setattr(mig, "EMBED_DELAY_S", 0)

    async def _noop_category(uid, slug):
        return None

    monkeypatch.setattr(mig, "add_user_category", _noop_category)


def _notes(fake_db):
    return {k: v for k, v in fake_db.docs.items() if k[0] == "notes"}


async def test_listicle_watch_items_regroup_into_one_note(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("users", "u", {})
    url = "https://instagram.com/reel/abc?igsh=junk"
    for i, title in enumerate(("Dune", "Arrival")):
        fake_db.docs[("users/u/watch_items", f"m_{i}")] = {
            "user_id": "u", "title": title, "media_type": "movie", "tmdb_id": i,
            "poster_url": f"https://img/{title}.jpg", "providers": [{"name": "Netflix"}],
            "providers_region": "IN", "source_url": url, "source_domain": "instagram.com",
            "watch_status": "to_watch", "favorite": i == 0, "source_note_ids": ["job-1"],
        }

    await mig.run(dry_run=False, heal=False, only_uid="u")

    notes = _notes(fake_db)
    assert len(notes) == 1  # one reel → one note, not two fragments
    note = next(iter(notes.values()))
    assert note["template"] == "entertainment"
    titles = note["data"]["titles"]
    assert {t["title"] for t in titles} == {"Dune", "Arrival"}
    assert titles[0]["providers"] == [{"name": "Netflix"}]  # enrichment folded into data
    assert note["cover_image_url"] == "https://img/Dune.jpg"
    assert note["is_favorite"] is True  # any favorited item stars the note
    assert note["source_url"] == url
    # watch_status buckets are deliberately dropped
    assert "watch_status" not in str(note["data"])
    # searchable again
    note_id = next(iter(notes))[1]
    assert ("search_index", f"note-{note_id}") in fake_db.docs


async def test_item_with_live_source_note_merges_not_duplicates(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("users", "u", {})
    fake_db.seed("notes", "n1", {
        "user_id": "u", "content_type": "entertainment", "title": "5 sci-fi films",
        "ai_summary": "", "cover_image_url": None,
        "data": {"titles": [{"title": "Dune", "mediaType": "movie"}]},
    })
    fake_db.docs[("users/u/watch_items", "m_1")] = {
        "user_id": "u", "title": "Dune", "media_type": "movie", "tmdb_id": 1,
        "poster_url": "https://img/dune.jpg", "overview": "Spice.",
        "providers": [{"name": "Prime"}], "favorite": True,
        "source_note_ids": ["n1"],
    }

    await mig.run(dry_run=False, heal=False, only_uid="u")

    assert len(_notes(fake_db)) == 1  # merged onto n1 — no duplicate
    note = fake_db.docs[("notes", "n1")]
    entry = note["data"]["titles"][0]
    assert entry["poster_url"] == "https://img/dune.jpg"
    assert entry["providers"] == [{"name": "Prime"}]
    assert note["cover_image_url"] == "https://img/dune.jpg"  # coverless note adopts poster
    assert note["is_favorite"] is True


async def test_migration_is_idempotent(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("users", "u", {})
    fake_db.docs[("users/u/wish_items", "p_1")] = {
        "user_id": "u", "title": "Headphones", "price_raw": "₹2,499",
        "price_amount": 2499.0, "currency": "₹", "buy_url": "https://amzn.in/x",
        "wish_status": "to_buy", "source_note_ids": [],
    }

    await mig.run(dry_run=False, heal=False, only_uid="u")
    first = set(_notes(fake_db))
    await mig.run(dry_run=False, heal=False, only_uid="u")

    assert set(_notes(fake_db)) == first  # re-run converges, no duplicate notes
    note = next(iter(_notes(fake_db).values()))
    assert note["template"] == "product"
    assert note["data"]["price_amount"] == 2499.0


async def test_dry_run_writes_nothing(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("users", "u", {})
    fake_db.docs[("users/u/trip_items", "t_1")] = {
        "user_id": "u", "title": "Goa", "destination": "Goa",
        "days": [{"day": 1, "stops": [{"place": "Baga", "lat": 1.0, "lng": 2.0}]}],
        "source_note_ids": [],
    }
    await mig.run(dry_run=True, heal=False, only_uid="u")
    assert not _notes(fake_db)


async def test_heal_refs_remaps_prefixed_item_ids(fake_db, monkeypatch):
    _prep(monkeypatch, fake_db)
    fake_db.seed("users", "u", {})
    fake_db.docs[("users/u/recipe_items", "r_1")] = {
        "user_id": "u", "title": "Dal", "ingredients": [{"items": ["dal"]}],
        "steps": ["cook"], "source_note_ids": [],
    }
    fake_db.seed("notes", "composed1", {
        "user_id": "u", "source": "ai", "title": "Meal plan",
        "source_note_ids": ["recipe-r_1", "other-note-id"],
    })

    await mig.run(dry_run=False, heal=True, only_uid="u")

    refs = fake_db.docs[("notes", "composed1")]["source_note_ids"]
    assert "recipe-r_1" not in refs  # prefixed item id remapped to the migrated note id
    assert "other-note-id" in refs
    assert any(r in {k[1] for k in _notes(fake_db)} for r in refs)


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
