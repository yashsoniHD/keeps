"""Reconciling mini-app item docs when a note's content_type changes (PATCH /notes/{id}).

The bug: a note wrongly saved as `movie` fans out into a watch_item; the user fixes the category
to `article`, but the watch_item stays visible in the Watchlist forever. update_note now reconciles
the family item docs — dropping items the note no longer belongs to, fanning out into families it
newly joins — best-effort so a reconciliation failure never fails the category change.

(Only the watch/place families remain — the wishlist/recipes/trips mini-apps and their fan-out
were removed 2026-07-12; see CLAUDE.md "Current State".)
"""
import pytest

import routers.notes as notes_mod
import services.item_reconcile as reconcile_mod


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    """Point every module that reaches for Firestore at the in-memory double, and stub the
    category registry helpers (they'd otherwise hit real Firestore)."""
    monkeypatch.setattr(notes_mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(reconcile_mod, "get_db", lambda: fake_db)

    async def fake_get_cats(uid):
        return []

    async def fake_add(uid, slug):
        return None

    async def fake_prune(uid, slug):
        return False

    monkeypatch.setattr(notes_mod, "get_user_categories", fake_get_cats)
    monkeypatch.setattr(notes_mod, "add_user_category", fake_add)
    monkeypatch.setattr(notes_mod, "prune_category_if_empty", fake_prune)
    return fake_db


def _watch_keys(db):
    return [k for k in db.docs if k[0] == "users/u/watch_items"]


async def test_movie_to_article_deletes_sole_source_watch_item(fake_db):
    """(a) Recategorising movie → article removes the watch_item whose ONLY source was this
    note — and de-indexes it from search so the Watchlist and search stop showing a ghost."""
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "movie"})
    fake_db.seed("users/u/watch_items", "m1",
                 {"user_id": "u", "title": "Dune", "source_note_ids": ["n1"]})
    fake_db.seed("search_index", "watch-m1", {"user_id": "u", "kind": "watch", "ref_id": "m1"})

    res = await notes_mod.update_note(
        "n1", notes_mod.NoteUpdate(content_type="article"), user_id="u")

    assert res == {"ok": True}
    assert fake_db.docs[("notes", "n1")]["content_type"] == "article"
    assert ("users/u/watch_items", "m1") not in fake_db.docs      # orphaned item deleted
    assert ("search_index", "watch-m1") not in fake_db.docs        # and de-indexed


async def test_recategorise_keeps_item_with_other_sources(fake_db):
    """(b) An item contributed by MORE than this note survives — only this note id is dropped from
    its source_note_ids (a shared roundup title stays for the other note)."""
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "movie"})
    fake_db.seed("users/u/watch_items", "m1",
                 {"user_id": "u", "title": "Dune", "source_note_ids": ["n1", "n2"]})

    res = await notes_mod.update_note(
        "n1", notes_mod.NoteUpdate(content_type="article"), user_id="u")

    assert res == {"ok": True}
    assert ("users/u/watch_items", "m1") in fake_db.docs          # NOT deleted
    assert fake_db.docs[("users/u/watch_items", "m1")]["source_note_ids"] == ["n2"]


async def test_same_family_recategorise_touches_nothing(fake_db):
    """(c) movie → entertainment are both the entertainment family — the note neither leaves nor
    joins, so the watch_item is left exactly as-is (no delete, no source-id churn)."""
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "movie"})
    fake_db.seed("users/u/watch_items", "w1",
                 {"user_id": "u", "title": "Dune", "source_note_ids": ["n1"]})

    res = await notes_mod.update_note(
        "n1", notes_mod.NoteUpdate(content_type="entertainment"), user_id="u")

    assert res == {"ok": True}
    assert fake_db.docs[("users/u/watch_items", "w1")]["source_note_ids"] == ["n1"]


async def test_reconciliation_error_does_not_fail_patch(fake_db, monkeypatch):
    """(d) A failure inside reconciliation is swallowed — the PATCH (the user's real intent) still
    succeeds. Here de-indexing a deleted item blows up; update_note must still return ok."""
    fake_db.seed("notes", "n1", {"user_id": "u", "content_type": "movie"})
    fake_db.seed("users/u/watch_items", "m1",
                 {"user_id": "u", "title": "Dune", "source_note_ids": ["n1"]})

    async def boom(*a, **k):
        raise RuntimeError("search index down")

    monkeypatch.setattr(reconcile_mod.search_index, "remove", boom)

    res = await notes_mod.update_note(
        "n1", notes_mod.NoteUpdate(content_type="article"), user_id="u")

    assert res == {"ok": True}                                   # PATCH survived the failure
    assert fake_db.docs[("notes", "n1")]["content_type"] == "article"


async def test_recategorise_into_entertainment_fans_out_watch_item(fake_db, monkeypatch):
    """Forward direction: recategorising a note INTO the entertainment family fans it out into a
    watch_item, reusing the same per-note enricher ingest uses. The note's titles[] already carry
    a tmdb_id (as enrich_note_data would have merged in at ingest), so no TMDB call is made."""
    fake_db.seed("notes", "n1", {
        "user_id": "u", "content_type": "summary", "title": "Movie note",
        "ai_summary": "", "cover_image_url": None, "source_domain": "movies.example",
        "data": {"titles": [{"title": "Dune", "year": "2021", "mediaType": "movie",
                             "tmdb_id": 438631, "poster_url": "https://img/dune.jpg"}]},
    })
    # The forward fan-out runs the watchlist enricher, which reaches for Firestore via its own
    # module (and its own region lookup).
    monkeypatch.setattr("services.watchlist.get_db", lambda: fake_db)

    res = await notes_mod.update_note(
        "n1", notes_mod.NoteUpdate(content_type="movie"), user_id="u")

    assert res == {"ok": True}
    assert _watch_keys(fake_db), "expected a watch_item to be created from the entertainment note"
    item = fake_db.docs[_watch_keys(fake_db)[0]]
    assert item["title"] == "Dune"
    assert item["tmdb_id"] == 438631
