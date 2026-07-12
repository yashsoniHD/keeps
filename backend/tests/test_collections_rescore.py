"""Smart collections: hybrid multi-membership matching + rescore.

`match_collections_by_embedding` is a pure function (no db, no async) — tested directly with
hand-picked vectors so the cosine math and pinned/excluded precedence are unambiguous.

`rescore_collection` is the (re)scoring operation that reconciles a collection's membership
against a user's whole corpus — it used to be called `assign_unassigned_to_collection`
("backfill"); this file replaces that test module now that membership is multi-home
(`note.collection_ids`) instead of single-home (`note.collection_id`).
"""
import services.collections as col
from services.gemini import gemini_service

# Simple orthogonal 2D vectors keep the cosine math readable by hand:
# similarity(SAME, SAME) = 1.0, similarity(SAME, ORTH) = 0.0, similarity(SAME, DIAG) ≈ 0.707.
SAME = [1.0, 0.0]
ORTH = [0.0, 1.0]
DIAG = [1.0, 1.0]


async def _embed_same(*a, **k):
    return SAME


# --- match_collections_by_embedding (pure matcher) -------------------------------------------

def test_matcher_returns_all_above_threshold_cids():
    """Multi-membership: a note above threshold for two collections matches both."""
    collections = [
        {"id": "a", "topic_embedding": SAME},
        {"id": "b", "topic_embedding": SAME},
    ]
    assert col.match_collections_by_embedding(SAME, "n1", collections) == ["a", "b"]


def test_matcher_below_threshold_excluded():
    collections = [{"id": "a", "topic_embedding": ORTH}]  # similarity 0.0 < default 0.55
    assert col.match_collections_by_embedding(SAME, "n1", collections) == []


def test_matcher_pinned_included_below_threshold():
    """A pinned note matches even though its similarity is far below threshold."""
    collections = [{"id": "a", "topic_embedding": ORTH, "pinned_note_ids": ["n1"]}]
    assert col.match_collections_by_embedding(SAME, "n1", collections) == ["a"]


def test_matcher_excluded_note_never_matches_even_above_threshold():
    collections = [{"id": "a", "topic_embedding": SAME, "excluded_note_ids": ["n1"]}]
    assert col.match_collections_by_embedding(SAME, "n1", collections) == []


def test_matcher_excluded_beats_pinned():
    """A note that's both pinned and excluded on the same collection is excluded — exclusion
    is the stronger override."""
    collections = [{
        "id": "a", "topic_embedding": SAME,
        "pinned_note_ids": ["n1"], "excluded_note_ids": ["n1"],
    }]
    assert col.match_collections_by_embedding(SAME, "n1", collections) == []


def test_matcher_skips_collections_without_topic_embedding():
    collections = [{"id": "a"}, {"id": "b", "topic_embedding": SAME}]
    assert col.match_collections_by_embedding(SAME, "n1", collections) == ["b"]


def test_matcher_respects_per_collection_match_threshold():
    """Same note/topic pair (similarity ≈ 0.707), different per-collection thresholds."""
    collections = [
        {"id": "strict", "topic_embedding": SAME, "match_threshold": 0.99},
        {"id": "loose", "topic_embedding": SAME, "match_threshold": 0.5},
    ]
    assert col.match_collections_by_embedding(DIAG, "n1", collections) == ["loose"]


# --- rescore_collection ------------------------------------------------------------------------

def _seed_rescore_scenario(fake_db):
    """One collection with a pin + an exclusion, and four notes covering every reconcile branch:
    a fresh match, a stale (no-longer-matching) member, a pinned member kept despite drift, and
    an excluded note that would otherwise match."""
    fake_db.seed("collections", "col_a", {
        "user_id": "u", "name": "Software", "description": "dev tools and gadgets",
        "pinned_note_ids": ["n_pinned"], "excluded_note_ids": ["n_excluded"],
    })
    fake_db.seed("notes", "n_match", {
        "user_id": "u", "title": "New match", "ai_summary": "", "embedding": SAME,
    })
    fake_db.seed("notes", "n_stale", {
        "user_id": "u", "title": "Drifted away", "ai_summary": "", "embedding": ORTH,
        "collection_ids": ["col_a"], "collection_id": "col_a",
    })
    fake_db.seed("notes", "n_pinned", {
        "user_id": "u", "title": "Pinned despite drift", "ai_summary": "", "embedding": ORTH,
        "collection_ids": ["col_a"], "collection_id": "col_a",
    })
    fake_db.seed("notes", "n_excluded", {
        "user_id": "u", "title": "Would match but excluded", "ai_summary": "", "embedding": SAME,
    })


async def test_rescore_adds_new_matches(fake_db, monkeypatch):
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    _seed_rescore_scenario(fake_db)

    res = await col.rescore_collection(fake_db, "u", "col_a")

    assert res["added"] == 1
    assert list(fake_db.docs[("notes", "n_match")]["collection_ids"]) == ["col_a"]
    assert fake_db.docs[("notes", "n_match")]["collection_id"] == "col_a"


async def test_rescore_removes_stale_non_pinned(fake_db, monkeypatch):
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    _seed_rescore_scenario(fake_db)

    res = await col.rescore_collection(fake_db, "u", "col_a")

    assert res["removed"] == 1
    assert fake_db.docs[("notes", "n_stale")]["collection_ids"] == []
    assert fake_db.docs[("notes", "n_stale")]["collection_id"] is None
    # Re-indexed with the cleared membership.
    idx = fake_db.docs.get(("search_index", "note-n_stale"))
    assert idx and idx["collection_id"] is None


async def test_rescore_never_removes_pinned(fake_db, monkeypatch):
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    _seed_rescore_scenario(fake_db)

    await col.rescore_collection(fake_db, "u", "col_a")

    assert fake_db.docs[("notes", "n_pinned")]["collection_ids"] == ["col_a"]


async def test_rescore_never_adds_excluded(fake_db, monkeypatch):
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    _seed_rescore_scenario(fake_db)

    await col.rescore_collection(fake_db, "u", "col_a")

    assert fake_db.docs[("notes", "n_excluded")].get("collection_ids") in (None, [])


async def test_rescore_matched_count_covers_new_and_pinned(fake_db, monkeypatch):
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    _seed_rescore_scenario(fake_db)

    res = await col.rescore_collection(fake_db, "u", "col_a")

    assert res["matched"] == 2  # n_match + n_pinned; n_stale removed, n_excluded never added


async def test_rescore_is_idempotent(fake_db, monkeypatch):
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    _seed_rescore_scenario(fake_db)

    first = await col.rescore_collection(fake_db, "u", "col_a")
    second = await col.rescore_collection(fake_db, "u", "col_a")

    assert first["matched"] == second["matched"] == 2
    assert second["added"] == 0
    assert second["removed"] == 0


async def test_rescore_persists_topic_query_and_embedding(fake_db, monkeypatch):
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    _seed_rescore_scenario(fake_db)

    await col.rescore_collection(fake_db, "u", "col_a")

    stored = fake_db.docs[("collections", "col_a")]
    assert stored["topic_query"] == "Software\ndev tools and gadgets"
    assert list(stored["topic_embedding"]) == SAME


async def test_rescore_missing_collection_is_noop(fake_db):
    res = await col.rescore_collection(fake_db, "u", "does-not-exist")
    assert res == {"matched": 0, "added": 0, "removed": 0, "reason": "collection not found"}


async def test_rescore_empty_name_is_noop(fake_db):
    fake_db.seed("collections", "c", {"user_id": "u", "name": "", "description": ""})
    res = await col.rescore_collection(fake_db, "u", "c")
    assert res["matched"] == 0 and res["added"] == 0 and res["removed"] == 0


async def test_rescore_expands_thin_query(fake_db, monkeypatch):
    """A short name ("AI") embeds too thin to match anything — the sweep must expand it into a
    descriptive query and embed THAT, not the bare token."""
    seen = {}

    async def fake_expand(name, description=""):
        seen["expand_args"] = (name, description)
        return "Artificial intelligence: AI tools, LLMs, machine learning research."

    async def fake_embed(text, *a, **k):
        seen["embedded"] = text
        return SAME

    monkeypatch.setattr(gemini_service, "expand_collection_query", fake_expand)
    monkeypatch.setattr(col.embedding_service, "embed_query", fake_embed)
    fake_db.seed("collections", "col_ai", {"user_id": "u", "name": "AI", "description": "AI"})

    await col.rescore_collection(fake_db, "u", "col_ai")

    assert seen["expand_args"] == ("AI", "AI")
    # Deduped raw text (no "AI\nAI") + the expansion, so short names still match semantically.
    assert seen["embedded"].startswith("AI\n")
    assert "machine learning" in seen["embedded"]


async def test_rescore_expansion_failure_falls_back_to_raw(fake_db, monkeypatch):
    """Expansion is best-effort: when the lite call fails (returns ""), the sweep embeds the raw
    name and still runs rather than erroring out."""
    async def fake_embed(text, *a, **k):
        assert text == "AI"  # raw fallback, deduped
        return SAME

    monkeypatch.setattr(col.embedding_service, "embed_query", fake_embed)  # conftest stubs expand→""
    fake_db.seed("collections", "col_ai", {"user_id": "u", "name": "AI", "description": "AI"})

    res = await col.rescore_collection(fake_db, "u", "col_ai")
    assert "reason" not in res


async def test_rescore_pins_note_with_no_embedding(fake_db, monkeypatch):
    """Finding 2: a pinned note whose embedding hasn't been computed yet (fresh capture, or an
    embed failure) must still get filed — the matcher decides the pin BEFORE it ever touches the
    vector, so the reconcile loop must not skip no-embedding candidates unconditionally."""
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    fake_db.seed("collections", "col_a", {
        "user_id": "u", "name": "Software", "description": "dev tools and gadgets",
        "pinned_note_ids": ["n_pinned_no_embedding"],
    })
    fake_db.seed("notes", "n_pinned_no_embedding", {
        "user_id": "u", "title": "Fresh capture, no embedding yet", "ai_summary": "",
        # No "embedding" key at all, and not yet carrying collection_ids/collection_id.
    })

    res = await col.rescore_collection(fake_db, "u", "col_a")

    assert res["added"] == 1
    assert fake_db.docs[("notes", "n_pinned_no_embedding")]["collection_ids"] == ["col_a"]
    assert fake_db.docs[("notes", "n_pinned_no_embedding")]["collection_id"] == "col_a"


async def test_rescore_no_embedding_non_pinned_left_untouched(fake_db, monkeypatch):
    """The other half of the finding-2 fix: a candidate with no embedding that ISN'T pinned must
    still be left alone (not added, not removed) — only the pin path changes behavior."""
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    fake_db.seed("collections", "col_a", {
        "user_id": "u", "name": "Software", "description": "dev tools and gadgets",
    })
    fake_db.seed("notes", "n_no_embedding_tagged", {
        "user_id": "u", "title": "Tagged but not yet embedded", "ai_summary": "",
        "collection_ids": ["col_a"], "collection_id": "col_a",
    })

    res = await col.rescore_collection(fake_db, "u", "col_a")

    assert res["added"] == 0
    assert res["removed"] == 0
    # Untouched: still carries its prior membership exactly as seeded.
    assert fake_db.docs[("notes", "n_no_embedding_tagged")]["collection_ids"] == ["col_a"]
    assert fake_db.docs[("notes", "n_no_embedding_tagged")]["collection_id"] == "col_a"


async def test_rescore_reconciles_legacy_scalar_only_tagged_note(fake_db, monkeypatch):
    """Finding 3: a note tagged only via the legacy scalar `collection_id` (the pre-migration
    ingest path never writes `collection_ids`) must still be visible to reconciliation, not just
    when it happens to land in the nearest-K vector shortlist. Force it out of the nearest-K
    shortlist with a K of 1 and an unrelated note inserted first, so only the new legacy-scalar
    query (not find_nearest, not the array_contains query) can surface it."""
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    monkeypatch.setattr(col.settings, "COLLECTION_BACKFILL_K", 1)
    fake_db.seed("collections", "col_a", {
        "user_id": "u", "name": "Software", "description": "dev tools and gadgets",
    })
    # Inserted first so the K=1 fake nearest-K query exhausts its limit on this note instead.
    fake_db.seed("notes", "n_dummy", {
        "user_id": "u", "title": "Unrelated, fills the K=1 shortlist", "ai_summary": "",
        "embedding": ORTH,
    })
    fake_db.seed("notes", "n_legacy", {
        "user_id": "u", "title": "Legacy scalar tagged, drifted away", "ai_summary": "",
        "embedding": ORTH, "collection_id": "col_a",  # scalar-only — no collection_ids array
    })

    res = await col.rescore_collection(fake_db, "u", "col_a")

    assert res["added"] == 0
    assert res["removed"] == 1
    assert fake_db.docs[("notes", "n_legacy")]["collection_ids"] == []
    assert fake_db.docs[("notes", "n_legacy")]["collection_id"] is None
    idx = fake_db.docs.get(("search_index", "note-n_legacy"))
    assert idx and idx["collection_id"] is None


async def test_rescore_long_description_skips_expansion(fake_db, monkeypatch):
    """A collection with a real description doesn't need (or pay for) the expansion call."""
    called = {"expand": False}

    async def fake_expand(name, description=""):
        called["expand"] = True
        return "should not be used"

    monkeypatch.setattr(gemini_service, "expand_collection_query", fake_expand)
    monkeypatch.setattr(col.embedding_service, "embed_query", _embed_same)
    desc = "AI tools, LLM articles, machine learning research papers and tutorials"
    fake_db.seed("collections", "col_ai", {"user_id": "u", "name": "AI", "description": desc})

    res = await col.rescore_collection(fake_db, "u", "col_ai")

    assert called["expand"] is False
    assert res["added"] == 0  # no notes seeded — just asserting the no-expansion path
