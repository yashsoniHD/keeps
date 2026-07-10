"""Worker routing after the notes-first collapse.

Every capture creates a note — mini-app families included. Family captures get their `data`
enriched in place (TMDB/Places/price) before the note is written, and a poster/photo is
adopted as the cover only when the note would otherwise be coverless.
"""
import routers.process as process
from models.note import ContentBundle, NoteExtraction


class DummyRequest:
    headers = {}


def _wire(monkeypatch, fake_db, *, content_type, collection_id=None, data=None,
          enriched_data=None, cover_override=None):
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)

    async def _noop(*a, **k):
        return None

    async def cats(uid):
        return []

    async def cols(uid):
        return []

    async def classify(url, bundle, existing, collections=None, note_hint=None):
        return content_type, collection_id

    async def extract(url, bundle, ct, note_hint=None):
        return NoteExtraction(content_type=ct, title="T", ai_summary="S",
                              cover_image_prompt="", data=data or {"facts": [{"a": "b" * 50}]})

    async def acquire(url):
        return ContentBundle(kind="text", text="x" * 60, metadata={"platform": "web"},
                             strategy="web_scrape")

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
    monkeypatch.setattr(process, "_note_embedding", _noop)
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


async def test_non_family_note_keeps_collection(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, content_type="article", collection_id="col_software")
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/post"})
    res = await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert len(notes) == 1
    assert notes[0]["collection_id"] == "col_software"
    assert res["destination"] == {"kind": "note", "note_id": res["note_id"]}


async def test_save_as_is_skips_enrichment(fake_db, monkeypatch):
    calls = _wire(monkeypatch, fake_db, content_type="note")
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "text",
                               "url": "", "text": "my raw text", "process_ai": False})
    res = await process.process_job("j", DummyRequest())
    assert len(_notes(fake_db)) == 1
    assert calls == []                                  # no-AI path never calls enrichment
    assert res["destination"]["kind"] == "note"
