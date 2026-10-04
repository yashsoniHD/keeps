"""Worker routing after the notes-first collapse.

Every capture creates a note. Entertainment captures get their `data` enriched in place (TMDB)
before the note is written; a poster is adopted as the cover only when the note is coverless.
Video bytes go to the video model; a video it can't read degrades to a thin caption note; a
YouTube URL the model can't read runs the fallback scraper.
"""
import routers.process as process
from models.note import ContentBundle, NoteExtraction
from services.gemini import VideoUnreadable


class DummyRequest:
    headers = {}


def _wire(monkeypatch, fake_db, *, content_type, data=None,
          enriched_data=None, cover_override=None, embedding=None, bundle=None, existing=None):
    """Wire the worker's happy path (classify → extract → enrich → write)."""
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)

    async def _noop(*a, **k):
        return None

    async def cats(uid):
        return list(existing or [])

    async def classify(url, bundle, existing, note_hint=None):
        return content_type

    async def extract(url, bundle, ct, note_hint=None, **_):
        return NoteExtraction(content_type=ct, title="T", ai_summary="S",
                              cover_image_prompt="", data=data or {"facts": [{"a": "b" * 50}]})

    async def acquire(url):
        return bundle if bundle is not None else ContentBundle(
            kind="text", text="x" * 60, metadata={"platform": "web"}, strategy="web_scrape")

    async def note_embedding(title, ai_summary="", data=None):
        return embedding

    enrich_calls = []

    async def fake_enrich(user_id, ct, d, cover):
        enrich_calls.append((user_id, ct, d, cover))
        return (enriched_data if enriched_data is not None else d,
                cover_override if not cover else None)

    monkeypatch.setattr(process, "get_user_categories", cats)
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
    assert "collection_ids" not in notes[0]             # collections were removed


async def test_save_as_is_skips_enrichment(fake_db, monkeypatch):
    calls = _wire(monkeypatch, fake_db, content_type="note")
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "text",
                               "url": "", "text": "my raw text", "process_ai": False})
    res = await process.process_job("j", DummyRequest())
    assert len(_notes(fake_db)) == 1
    assert calls == []                                  # no-AI path never calls enrichment
    assert res["destination"]["kind"] == "note"


def _seed(fake_db, url="https://www.instagram.com/reel/abc/"):
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": url})


def _reel_bundle():
    return ContentBundle(kind="text", text="caption text", images=["https://cdn/t.jpg"],
                         metadata={"platform": "instagram", "caption": "caption text",
                                   "comments": ["c1"], "video_bytes": b"MP4",
                                   "video_mime": "video/mp4"},
                         strategy="reel_video")


async def test_reel_video_goes_to_video_model(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, content_type=None, bundle=_reel_bundle(), existing=["recipe"])
    seen = {}

    async def from_video(video, mime, caption, comments, type_hint, categories=None):
        seen.update(video=video, mime=mime, caption=caption, comments=comments, hint=type_hint,
                    categories=categories)
        return NoteExtraction(content_type="Recipes", title="Dal", ai_summary="S",
                              data={"ingredients": [{"items": ["1 cup dal"]}], "steps": ["a"]})

    monkeypatch.setattr(process.gemini_service, "extract_from_video", from_video)
    _seed(fake_db)
    await process.process_job("j", DummyRequest())
    note = _notes(fake_db)[0]
    assert seen == {"video": b"MP4", "mime": "video/mp4", "caption": "caption text",
                    "comments": ["c1"], "hint": None, "categories": ["recipe"]}
    assert note["content_type"] == "recipe"          # model's slug snapped onto the taxonomy
    assert note["acquisition"] == "reel_video"
    assert "thin" not in note["data"]


async def test_unreadable_video_degrades_to_thin_caption_note(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, content_type="summary", bundle=_reel_bundle())

    async def from_video(*a, **_):
        raise VideoUnreadable("too big")

    monkeypatch.setattr(process.gemini_service, "extract_from_video", from_video)
    _seed(fake_db)
    res = await process.process_job("j", DummyRequest())
    note = _notes(fake_db)[0]
    assert res["status"] == "completed" and not res.get("salvaged")
    assert note["data"]["thin"] is True
    assert note["acquisition"] == "reel_video_thin"
    assert note["cover_image_url"] == "https://cdn/t.jpg"


async def test_youtube_unreadable_runs_fallback_scraper(fake_db, monkeypatch):
    yt = ContentBundle(kind="video_uri", video_uri="https://youtu.be/x", strategy="youtube_direct",
                       metadata={"platform": "youtube"})
    _wire(monkeypatch, fake_db, content_type="summary", bundle=yt)
    calls = []

    async def extract(url, bundle, ct, note_hint=None, **_):
        calls.append(bundle.strategy)
        if bundle.strategy == "youtube_direct":
            raise VideoUnreadable("age gated")
        return NoteExtraction(content_type=ct, title="T", ai_summary="S",
                              data={"tldr": "x" * 60})

    async def fallback(url, bundle):
        return ContentBundle(kind="text", text="captions " * 40, strategy="youtube_fallback",
                             metadata={"platform": "youtube", "via": "captions"})

    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process.sources.youtube, "fallback", fallback)
    _seed(fake_db, "https://youtu.be/x")
    await process.process_job("j", DummyRequest())
    assert calls == ["youtube_direct", "youtube_fallback"]
    assert _notes(fake_db)[0]["acquisition"] == "youtube_fallback"


async def test_capped_taxonomy_snaps_category_but_keeps_recipe_template(fake_db, monkeypatch):
    """At the category cap a recipe reel's *category* may snap to an existing slug, but the
    render template must stay the schema the data was built for."""
    existing = [f"cat-{i}" for i in range(process.settings.MAX_USER_CATEGORIES - 1)] + ["summary"]
    _wire(monkeypatch, fake_db, content_type=None, bundle=_reel_bundle(), existing=existing)

    async def from_video(*a, **_):
        return NoteExtraction(content_type="recipe", title="Dal", ai_summary="S",
                              data={"ingredients": [{"items": ["1 cup dal"]}], "steps": ["a"]})

    monkeypatch.setattr(process.gemini_service, "extract_from_video", from_video)
    monkeypatch.setattr(process, "closest_existing", lambda slug, ex: "summary")
    _seed(fake_db)
    await process.process_job("j", DummyRequest())
    note = _notes(fake_db)[0]
    assert note["content_type"] == "summary"
    assert note["template"] == "recipe"


async def test_unreadable_video_with_no_caption_salvages_not_hallucinates(fake_db, monkeypatch):
    bare = ContentBundle(kind="text", text=None, images=["https://cdn/t.jpg"],
                         metadata={"platform": "instagram", "video_bytes": b"MP4"},
                         strategy="reel_video")
    _wire(monkeypatch, fake_db, content_type=None, bundle=bare)
    extracts = []

    async def from_video(*a, **_):
        raise VideoUnreadable("timeout")

    async def extract(*a, **k):
        extracts.append(a)

    async def no_preview(url):
        return {}

    monkeypatch.setattr(process.gemini_service, "extract_from_video", from_video)
    monkeypatch.setattr(process.gemini_service, "extract_async", extract)
    monkeypatch.setattr(process, "_link_preview", no_preview)
    _seed(fake_db)
    res = await process.process_job("j", DummyRequest())
    assert res.get("salvaged") is True and extracts == []
    assert _notes(fake_db)[0]["content_type"] == "bookmark"


def test_too_long_note_text():
    assert process.too_long_note(8040, 600) == (
        "Video is 2 h 14 m, over the 10-minute limit; note built from the caption.")
    assert process.too_long_note(7200, 3600, "description") == (
        "Video is 2 h, over the 60-minute limit; note built from the description.")
    assert process.too_long_note(900, 600).startswith("Video is 15 m,")


async def test_too_long_bundle_writes_thin_and_note(fake_db, monkeypatch):
    b = ContentBundle(kind="text", text="a long podcast caption", strategy="reel_caption",
                      metadata={"platform": "tiktok", "too_long": True, "duration": 8040})
    _wire(monkeypatch, fake_db, content_type="summary", bundle=b)
    _seed(fake_db, "https://www.tiktok.com/@u/video/1")
    await process.process_job("j", DummyRequest())
    data = _notes(fake_db)[0]["data"]
    assert data["thin"] is True
    assert data["note"] == "Video is 2 h 14 m, over the 10-minute limit; note built from the caption."
