"""Worker routing after the notes-first collapse.

Every capture creates a note — mini-app families included. Family captures get their `data`
enriched in place (TMDB/Places/price) before the note is written, and a poster/photo is
adopted as the cover only when the note would otherwise be coverless.
"""
import routers.process as process
from models.note import ContentBundle, NoteExtraction


class DummyRequest:
    headers = {}


def _wire(monkeypatch, fake_db, *, content_type, data=None,
          enriched_data=None, cover_override=None, embedding=None, collections=None):
    """Wire the worker's happy path. `embedding`/`collections` drive smart-collection matching
    (services.collections.match_collections_by_embedding runs for real here — only
    get_user_collections and the note's own embedding are stubbed) — content_type routing no
    longer carries a collection_id (classify() is content_type-only now)."""
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)

    async def _noop(*a, **k):
        return None

    async def cats(uid):
        return []

    async def cols(uid):
        return collections or []

    async def classify(url, bundle, existing, note_hint=None):
        return content_type

    async def extract(url, bundle, ct, note_hint=None):
        return NoteExtraction(content_type=ct, title="T", ai_summary="S",
                              cover_image_prompt="", data=data or {"facts": [{"a": "b" * 50}]})

    async def acquire(url):
        return ContentBundle(kind="text", text="x" * 60, metadata={"platform": "web"},
                             strategy="web_scrape")

    async def note_embedding(title, ai_summary="", data=None):
        return embedding

    enrich_calls = []

    async def fake_enrich(user_id, ct, d, cover):
        enrich_calls.append((user_id, ct, d, cover))
        return (enriched_data if enriched_data is not None else d,
                cover_override if not cover else None)

    monkeypatch.setattr(process, "get_user_categories", cats)
    monkeypatch.setattr(process, "get_user_collections", cols)
    monkeypatch.setattr(process, "add_user_category", _noop)
    monkeypatch.setattr(process, "add_user_source", _noop)
    monkeypatch.setattr(process, "touch_user_activity", _noop)
    monkeypatch.setattr(process, "_note_embedding", note_embedding)
    monkeypatch.setattr(process, "enrich_note_data", fake_enrich)
    monkeypatch.setattr(process.gemini_service, "classify", classify)
    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "acquire", acquire)
    return enrich_calls


def _notes(fake_db):
    return [v for (c, _), v in fake_db.docs.items() if c == "notes"]


async def test_recipe_capture_creates_a_note(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, content_type="recipe",
          data={"ingredients": [{"items": ["dal", "rice"]}], "steps": ["cook"]})
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/dal"})
    res = await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert len(notes) == 1                              # a family capture IS a note again
    assert notes[0]["template"] == "recipe"
    assert res["destination"] == {"kind": "note", "note_id": res["note_id"]}
    assert fake_db.docs[("jobs", "j")]["note_id"] == res["note_id"]


async def test_entertainment_capture_gets_enriched_data_and_poster_cover(fake_db, monkeypatch):
    enriched = {"titles": [{"title": "Dune", "poster_url": "https://img/d.jpg",
                            "providers": [{"name": "Netflix"}]}]}
    calls = _wire(monkeypatch, fake_db, content_type="movie",
                  data={"titles": [{"title": "Dune", "why": "a stunning sci-fi epic"}]},
                  enriched_data=enriched, cover_override="https://img/d.jpg")
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/films"})
    res = await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert len(notes) == 1
    assert notes[0]["data"] == enriched                 # enrichment landed on the note itself
    assert notes[0]["cover_image_url"] == "https://img/d.jpg"  # coverless → poster adopted
    assert calls and calls[0][1] == "movie"
    assert res["destination"]["kind"] == "note"
    # Indexed for search.
    assert any(c == "search_index" for (c, _) in fake_db.docs)


async def test_matched_collection_sets_ids_scalar_and_mirror(fake_db, monkeypatch):
    """A note whose embedding clears a collection's threshold gets collection_ids=[cid], the
    legacy scalar collection_id kept coherent, and both mirrored into search_index — membership
    is now decided by embedding match at ingest, not the classifier."""
    _wire(monkeypatch, fake_db, content_type="article", embedding=[1.0, 0.0],
          collections=[{"id": "col_software", "topic_embedding": [1.0, 0.0]}])
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/post"})
    res = await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert len(notes) == 1
    assert notes[0]["collection_ids"] == ["col_software"]
    assert notes[0]["collection_id"] == "col_software"
    idx = fake_db.docs.get(("search_index", f"note-{res['note_id']}"))
    assert idx is not None
    assert idx["collection_ids"] == ["col_software"]
    assert idx["collection_id"] == "col_software"
    assert res["destination"] == {"kind": "note", "note_id": res["note_id"]}


async def test_two_matching_collections_are_both_recorded(fake_db, monkeypatch):
    """Multi-membership: a note can clear the threshold for more than one collection."""
    _wire(monkeypatch, fake_db, content_type="article", embedding=[1.0, 0.0],
          collections=[
              {"id": "col_a", "topic_embedding": [1.0, 0.0]},
              {"id": "col_b", "topic_embedding": [1.0, 0.0]},
          ])
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/post"})
    await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert sorted(notes[0]["collection_ids"]) == ["col_a", "col_b"]
    assert notes[0]["collection_id"] in ("col_a", "col_b")


async def test_no_embedding_means_no_collection_match(fake_db, monkeypatch):
    """Embedding failure is non-fatal (the note is still written) but leaves it unmatched —
    a note with no embedding can't be scored against any collection's topic_embedding."""
    _wire(monkeypatch, fake_db, content_type="article", embedding=None,
          collections=[{"id": "col_software", "topic_embedding": [1.0, 0.0]}])
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/post"})
    await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert notes[0]["collection_ids"] == []
    assert notes[0]["collection_id"] is None


async def test_collection_matching_failure_does_not_lose_the_note(fake_db, monkeypatch):
    """get_user_collections raising (e.g. a Firestore hiccup) must not fall through to the
    generic exception handler and salvage the job — that would throw away the paid
    classify+extract work over a purely cosmetic feature. The note is written normally, just
    with no collection_ids."""
    _wire(monkeypatch, fake_db, content_type="article", embedding=[1.0, 0.0])

    async def boom(uid):
        raise RuntimeError("firestore hiccup")

    monkeypatch.setattr(process, "get_user_collections", boom)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/post"})
    res = await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert res["status"] == "completed"
    assert len(notes) == 1
    assert notes[0].get("acquisition") != "salvage"      # the real extraction was NOT discarded
    assert notes[0]["collection_ids"] == []
    assert notes[0]["collection_id"] is None


async def test_save_as_is_skips_enrichment(fake_db, monkeypatch):
    calls = _wire(monkeypatch, fake_db, content_type="note")
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "text",
                               "url": "", "text": "my raw text", "process_ai": False})
    res = await process.process_job("j", DummyRequest())
    assert len(_notes(fake_db)) == 1
    assert calls == []                                  # no-AI path never calls enrichment
    assert res["destination"]["kind"] == "note"
