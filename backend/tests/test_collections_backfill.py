"""Smart-collection backfill: assign existing, unassigned notes into a newly created bucket."""
import services.collections as col
from services.gemini import gemini_service


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
    assert res["already_filed"] == 1  # n2 matched but single-home keeps it where it is
    assert fake_db.docs[("notes", "n1")]["collection_id"] == "col_sw"   # swept in
    assert fake_db.docs[("notes", "n2")]["collection_id"] == "col_other"  # single-home preserved
    # The reassigned note is re-indexed with its new collection.
    idx = fake_db.docs.get(("search_index", "note-n1"))
    assert idx and idx["collection_id"] == "col_sw"


async def test_backfill_empty_name_is_noop(fake_db):
    res = await col.assign_unassigned_to_collection(fake_db, "u", "c", "", "")
    assert res["assigned"] == 0


async def test_backfill_expands_thin_query(fake_db, monkeypatch):
    """A short name ("AI") embeds too thin to match anything — the sweep must expand it into a
    descriptive query and embed THAT, not the bare token."""
    seen = {}

    async def fake_expand(name, description=""):
        seen["expand_args"] = (name, description)
        return "Artificial intelligence: AI tools, LLMs, machine learning research."

    async def fake_embed(text, *a, **k):
        seen["embedded"] = text
        return [0.0] * 8

    monkeypatch.setattr(gemini_service, "expand_collection_query", fake_expand)
    monkeypatch.setattr(col.embedding_service, "embed_query", fake_embed)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Intro to LLMs",
                                 "ai_summary": "", "embedding": [0.0], "collection_id": None})

    res = await col.assign_unassigned_to_collection(fake_db, "u", "col_ai", "AI", "AI")

    assert seen["expand_args"] == ("AI", "AI")
    # Deduped raw text (no "AI\nAI") + the expansion, so short names still match semantically.
    assert seen["embedded"].startswith("AI\n")
    assert "machine learning" in seen["embedded"]
    assert res["assigned"] == 1


async def test_backfill_expansion_failure_falls_back_to_raw(fake_db, monkeypatch):
    """Expansion is best-effort: when the lite call fails (returns ""), the sweep embeds the raw
    name and still runs rather than erroring out."""
    async def fake_embed(text, *a, **k):
        assert text == "AI"  # raw fallback, deduped
        return [0.0] * 8

    monkeypatch.setattr(col.embedding_service, "embed_query", fake_embed)  # conftest stubs expand→""
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "Intro to LLMs",
                                 "ai_summary": "", "embedding": [0.0], "collection_id": None})

    res = await col.assign_unassigned_to_collection(fake_db, "u", "col_ai", "AI", "AI")
    assert res["assigned"] == 1


async def test_backfill_long_description_skips_expansion(fake_db, monkeypatch):
    """A collection with a real description doesn't need (or pay for) the expansion call."""
    called = {"expand": False}

    async def fake_expand(name, description=""):
        called["expand"] = True
        return "should not be used"

    monkeypatch.setattr(gemini_service, "expand_collection_query", fake_expand)
    desc = "AI tools, LLM articles, machine learning research papers and tutorials"
    res = await col.assign_unassigned_to_collection(fake_db, "u", "col_ai", "AI", desc)

    assert called["expand"] is False
    assert res["assigned"] == 0  # no notes seeded — just asserting the no-expansion path
