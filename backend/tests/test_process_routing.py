"""Worker routing after the library-first restructure (Phase 1).

Mini-app captures (recipe/movie/product/place/trip) must NOT create a note — they fan out into
their app's item(s) and the job records an app `destination`. Everything else creates a note with
the AI-assigned `collection_id` and a note `destination`.
"""
import routers.process as process
from models.note import ContentBundle, NoteExtraction


class DummyRequest:
    headers = {}


def _wire(monkeypatch, fake_db, *, content_type, collection_id=None, data=None, item_ids=None):
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

    monkeypatch.setattr(process, "get_user_categories", cats)
    monkeypatch.setattr(process, "get_user_collections", cols)
    monkeypatch.setattr(process, "add_user_category", _noop)
    monkeypatch.setattr(process, "add_user_source", _noop)
    monkeypatch.setattr(process, "touch_user_activity", _noop)
    monkeypatch.setattr(process, "_note_embedding", _noop)
    monkeypatch.setattr(process.gemini_service, "classify", classify)
    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources, "acquire", acquire)

    # Capture fan-out args and return canned item ids per family.
    async def fake_titles(uid, source_id, titles, region=None,
                          source_url=None, source_domain=None):
        return item_ids or []

    async def fake_places(uid, source_id, venues, region=None):
        return item_ids or []

    async def fake_recipe(uid, source_id, **k):
        return (item_ids or [None])[0]

    monkeypatch.setattr(process, "enrich_titles", fake_titles)
    monkeypatch.setattr(process, "enrich_places", fake_places)
    monkeypatch.setattr(process, "enrich_recipe_item", fake_recipe)


def _notes(fake_db):
    return [v for (c, _), v in fake_db.docs.items() if c == "notes"]


async def test_recipe_capture_makes_no_note(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, content_type="recipe",
          data={"ingredients": [{"items": ["dal", "rice"]}], "steps": ["cook"]},
          item_ids=["r_1"])
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/dal"})
    res = await process.process_job("j", DummyRequest())
    assert _notes(fake_db) == []                       # no note doc for a mini-app capture
    assert res["destination"] == {"kind": "app", "app": "recipes", "item_id": "r_1"}
    assert fake_db.docs[("jobs", "j")]["note_id"] is None


async def test_multi_item_capture_lands_on_app_index(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, content_type="movie",
          data={"titles": [{"title": "A"}, {"title": "B"}]}, item_ids=["m_1", "m_2"])
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/films"})
    res = await process.process_job("j", DummyRequest())
    assert _notes(fake_db) == []
    # Several items → no single item_id, land on the app index.
    assert res["destination"] == {"kind": "app", "app": "watchlist"}


async def test_non_miniapp_creates_note_with_collection(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, content_type="article", collection_id="col_software")
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/post"})
    res = await process.process_job("j", DummyRequest())
    notes = _notes(fake_db)
    assert len(notes) == 1
    assert notes[0]["collection_id"] == "col_software"
    assert res["destination"] == {"kind": "note", "note_id": res["note_id"]}
    # Indexed for search.
    assert any(c == "search_index" for (c, _) in fake_db.docs)


async def test_miniapp_with_no_item_falls_back_to_note(fake_db, monkeypatch):
    # A recipe slug whose extraction yields no cookable data → fan-out returns nothing → note.
    _wire(monkeypatch, fake_db, content_type="recipe",
          data={"facts": [{"note": "x" * 50}]}, item_ids=[])
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://ex.com/vague"})
    res = await process.process_job("j", DummyRequest())
    assert len(_notes(fake_db)) == 1                   # nothing materialized → saved as a note
    assert res["destination"]["kind"] == "note"
