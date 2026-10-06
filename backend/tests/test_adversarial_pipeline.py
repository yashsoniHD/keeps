"""Adversarial tests for the simplified video pipeline (feat/simplify-video-notes).

Goal: break it, not confirm it. No network, no real Firestore: OpenRouter's sync client, the
ladder rungs and Firestore are faked. Tests that expose a real bug are left failing on purpose
(see the report) — they are marked with `BUG:` in their docstring.
"""
import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import openai
import pytest
from fastapi import HTTPException

import routers.ingest as ingest_mod
import routers.process as process
import routers.search as search_mod
import services.acq_cache as acq_cache
import services.apify as apify
import services.firebase as firebase_mod
import services.sources.social_video as sv
import services.sources.youtube as yt
from config import settings
from conftest import chat_resp
from models.note import ContentBundle, NoteExtraction
from services import gemini
from services.usage_meter import start_metering
from services.gemini import JSON_NUDGE, VideoUnreadable, gemini_service, job_deadline, parse_json

NOTE = {"content_type": "recipe", "title": "T", "ai_summary": "S",
        "data": {"steps": ["a long enough step to pass the 40 char data gate"]}}
NOTE_JSON = json.dumps(NOTE)


# ---------------------------------------------------------------- helpers

class _L(list):
    pass


@pytest.fixture
def calls2(monkeypatch):
    # Legacy extraction transport tests; document pipeline has its own adversarial cases.
    monkeypatch.setattr(settings, "NOTE_DOCUMENTS_ENABLED", False)
    seen = _L()
    seen.replies = []

    def fake_create(**kwargs):
        seen.append(kwargs)
        reply = seen.replies.pop(0) if seen.replies else NOTE_JSON
        if isinstance(reply, Exception):
            raise reply
        return reply if isinstance(reply, SimpleNamespace) else chat_resp(reply)

    monkeypatch.setattr(gemini_service.client.chat.completions, "create", fake_create)
    return seen


def _timeout():
    return openai.APITimeoutError(request=httpx.Request("POST", "https://openrouter.ai"))


def _status(code):
    req = httpx.Request("POST", "https://openrouter.ai")
    return openai.APIStatusError("boom", response=httpx.Response(code, request=req), body=None)


@pytest.fixture
def deadline():
    """Set the job deadline ContextVar; reset after."""
    tokens = []

    def _set(remaining):
        tokens.append(job_deadline.set(time.monotonic() + remaining))

    yield _set
    for t in reversed(tokens):
        job_deadline.reset(t)


# ---------------------------------------------------------------- 1. model chain / 429 / timeout

def test_free_429_handled_by_models_chain_and_paid_model_recorded(calls2, monkeypatch):
    """A free-model 429 is OpenRouter's job: a chain of >=2 models goes out as `models` in ONE
    request, and the model that actually answered (the paid floor) is what we record. The
    default video chain is a single paid model, so pin a two-model chain here."""
    chain = ["free/omni:free", "google/gemini-2.5-flash-lite"]
    monkeypatch.setattr(settings, "VIDEO_MODELS", chain)
    meter = start_metering()
    calls2.replies = [SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=NOTE_JSON))],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, cost=0.001), model=chain[-1])]
    parsed = gemini_service._extract_from_video(b"x" * 10, "video/mp4", "cap", [], None)
    assert len(calls2) == 1
    assert calls2[0]["model"] == chain[0]
    assert calls2[0]["extra_body"]["models"] == chain
    assert meter.last_model == chain[-1]
    assert parsed.content_type == "recipe"


def test_single_model_video_chain_sends_no_models_list_and_429_is_unreadable(calls2):
    assert len(settings.VIDEO_MODELS) == 1
    calls2.replies = [_status(429)]
    with pytest.raises(VideoUnreadable):
        gemini_service._extract_from_video(b"x" * 10, "video/mp4", "cap", [], None)
    assert len(calls2) == 1
    assert "models" not in calls2[0]["extra_body"]


def test_timeout_retries_rest_of_chain_only_with_30s_left(calls2, deadline):
    deadline(31)
    calls2.replies = [_timeout(), NOTE_JSON]
    text, used = gemini_service._chat(["free:free", "paid"], "s", "t", timeout=20)
    assert [c["model"] for c in calls2] == ["free:free", "paid"]
    assert "models" not in calls2[1]["extra_body"]      # single-model remainder
    assert calls2[1]["timeout"] <= 31 - 15 + 0.5        # retry never outlives the budget


def test_timeout_with_29s_left_does_not_retry(calls2, deadline):
    deadline(29)
    calls2.replies = [_timeout()]
    with pytest.raises(openai.APITimeoutError):
        gemini_service._chat(["free:free", "paid"], "s", "t", timeout=20)
    assert len(calls2) == 1


def test_timeout_on_both_models_becomes_video_unreadable(calls2, deadline, monkeypatch):
    deadline(250)
    # Default single-model chain: one timeout → VideoUnreadable after exactly one call.
    calls2.replies = [_timeout()]
    with pytest.raises(VideoUnreadable):
        gemini_service._extract_from_video(b"x" * 10, "video/mp4", "cap", [], None)
    assert len(calls2) == 1
    # Two-model chain: the timeout walks the rest of the chain once, then gives up.
    monkeypatch.setattr(settings, "VIDEO_MODELS", ["a:free", "b"])
    calls2.clear()
    calls2.replies = [_timeout(), _timeout()]
    with pytest.raises(VideoUnreadable):
        gemini_service._extract_from_video(b"x" * 10, "video/mp4", "cap", [], None)
    assert [c["model"] for c in calls2] == ["a:free", "b"]


def test_429_on_every_model_becomes_video_unreadable(calls2):
    calls2.replies = [_status(429)]
    with pytest.raises(VideoUnreadable):
        gemini_service._extract_from_video(b"x" * 10, "video/mp4", "cap", [], None)


def test_over_cap_video_never_calls_the_model(calls2, monkeypatch):
    monkeypatch.setattr(settings, "VIDEO_MAX_BYTES", 100)
    with pytest.raises(VideoUnreadable):
        gemini_service._extract_from_video(b"x" * 101, "video/mp4", "cap", [], None)
    assert calls2 == []


def test_call_timeout_floor_can_exceed_remaining_budget(deadline):
    """_call_timeout floors at 15 s even when only 5 s of the job remain — a call can then run
    past JOB_DEADLINE_S (270 s) up to 285 s, still under Vercel's 300 s kill. Documenting."""
    deadline(5)
    assert gemini._call_timeout(120) == 15.0


# ---------------------------------------------------------------- 2. tolerant JSON

@pytest.mark.parametrize("raw", [
    "<think>let me think {not json}</think>" + NOTE_JSON,
    "```json\n" + NOTE_JSON + "\n```",
    "```json\n" + NOTE_JSON + "\n```\nHope this helps!",
    "Here is the JSON:\n```json\n" + NOTE_JSON + "\n```",
    NOTE_JSON + "\n\nLet me know if you need changes.",
    "<think>\nmulti\nline\n</think>\n\n```\n" + NOTE_JSON + "\n```",
])
def test_parse_json_repairs_common_free_model_noise(raw):
    assert parse_json(raw)["title"] == "T"


@pytest.mark.parametrize("raw", [
    '{"content_type": "recipe", "title": "T", "ai_summ',           # truncated (max_tokens)
    "<think>I will emit {content_type} next" + NOTE_JSON,          # unclosed think with braces
    NOTE_JSON + " P.S. {not json}",                                 # trailing braces
])
def test_unparseable_replies_raise_so_the_nudge_runs(raw):
    with pytest.raises(ValueError):
        parse_json(raw)


def test_truncated_json_goes_through_one_nudge_on_text_models(calls2):
    bad = '{"content_type": "recipe", "title": "T", "ai_summ'
    calls2.replies = [bad, NOTE_JSON]
    parsed, used = gemini_service._note_json(settings.VIDEO_MODELS, "SYS", "BIG PAYLOAD")
    assert parsed.title == "T"
    nudge = calls2[1]
    assert nudge["model"] == settings.TEXT_MODELS[0]
    assert nudge["messages"][0]["content"].startswith("SYS" + JSON_NUDGE)
    assert nudge["messages"][-1]["content"] == bad          # only the bad reply, not the payload
    assert used == settings.VIDEO_MODELS[0]                 # credited to the original model


def test_nudge_that_is_still_bad_raises(calls2):
    calls2.replies = ["{bad", "still {bad"]
    with pytest.raises(ValueError):
        gemini_service._note_json(settings.TEXT_MODELS, "S", "P")
    assert len(calls2) == 2                                  # exactly one nudge, no loop


@pytest.mark.parametrize("empty", ["", "   \n  "])
def test_empty_reply_raises_without_nudge(calls2, empty):
    calls2.replies = [empty]
    with pytest.raises(ValueError, match="empty reply"):
        gemini_service._note_json(settings.TEXT_MODELS, "S", "P")
    assert len(calls2) == 1


def test_no_choices_is_an_empty_reply(calls2):
    """A 200 with no choices is OpenRouter's provider-error shape: the text path fails loudly
    with ProviderError (never returns ""), and the video path turns it into VideoUnreadable."""
    calls2.replies = [SimpleNamespace(choices=[], usage=None)]
    with pytest.raises(gemini.ProviderError, match="empty reply"):
        gemini_service._note_json(settings.TEXT_MODELS[:1], "S", "P")  # no chain → no retry
    calls2.replies = [SimpleNamespace(choices=None, usage=None, error={"message": "down"})]
    with pytest.raises(VideoUnreadable, match="down"):
        gemini_service._extract_from_video(b"x" * 10, "video/mp4", "cap", [], None)


def test_think_only_reply_is_treated_as_empty(calls2):
    """A reasoning model that spends max_tokens thinking returns ONLY a <think> block. That
    holds nothing to repair; nudging just sends the model's private reasoning back to
    TEXT_MODELS (a paid call that can only invent a note). Expected: treated as empty."""
    calls2.replies = ["<think>long reasoning, ran out of tokens</think>", NOTE_JSON]
    with pytest.raises(ValueError, match="empty reply"):
        gemini_service._note_json(settings.TEXT_MODELS, "S", "P")


# ---------------------------------------------------------------- 3. classify for video

async def test_classify_returns_none_for_reels_without_calling_model(calls2):
    b = ContentBundle(kind="text", text="cap", strategy="reel_caption")
    assert await gemini_service.classify("https://www.instagram.com/reel/X/", b, ["recipe"]) is None
    assert calls2 == []


async def test_classify_social_og_reel_is_still_a_video_source(calls2):
    b = ContentBundle(kind="text", text="cap", strategy="social_og")
    assert await gemini_service.classify("https://www.instagram.com/reel/X/", b, []) is None


async def test_classify_all_models_429_propagates_as_transient(calls2):
    """A non-video classify call that 429s on every model must raise (transient → retry), not
    silently default to 'summary'."""
    calls2.replies = [_status(429)]
    b = ContentBundle(kind="text", text="an article", strategy="web_scrape")
    with pytest.raises(openai.APIStatusError):
        await gemini_service.classify("https://example.com/a", b, [])
    assert process._is_transient(_status(429))


# ---------------------------------------------------------------- 4. process: worker wiring

class DummyRequest:
    headers = {}


def _wire(monkeypatch, fake_db, *, bundle, existing=(), extract=None, video=None):
    monkeypatch.setattr(process, "_verify_oidc", lambda request: None)
    monkeypatch.setattr(process, "get_db", lambda: fake_db)
    st = {"extract_calls": [], "video_calls": [], "added": []}

    async def _noop(*a, **k):
        return None

    async def cats(uid):
        return list(existing)

    async def add_cat(uid, slug):
        st["added"].append(slug)

    async def acquire(url):
        return bundle.model_copy(deep=True)

    async def enrich(uid, ct, d, cover):
        return d, None

    async def default_extract(url, b, ct, hint=None, **_):
        st["extract_calls"].append((b.strategy, ct))
        return NoteExtraction(content_type=ct or "recipe", title="T", ai_summary="S",
                              data={"steps": ["x" * 60]})

    async def default_video(vb, mime, cap, comments, hint, **_):
        st["video_calls"].append(hint)
        if isinstance(video, Exception):
            raise video
        return video

    monkeypatch.setattr(process, "get_user_categories", cats)
    monkeypatch.setattr(process, "add_user_category", add_cat)
    monkeypatch.setattr(process, "add_user_source", _noop)
    monkeypatch.setattr(process, "touch_user_activity", _noop)
    monkeypatch.setattr(process, "flush_usage", _noop)
    monkeypatch.setattr(process, "enrich_note_data", enrich)
    monkeypatch.setattr(process.sources, "acquire", acquire)
    monkeypatch.setattr(process.gemini_service, "extract_async", extract or default_extract)
    monkeypatch.setattr(process.gemini_service, "extract_from_video", default_video)
    fake_db.seed("jobs", "j", {"status": "pending", "user_id": "u", "input_type": "url",
                               "url": "https://www.instagram.com/reel/ABC/"})
    return st


def _notes(fake_db):
    return [v for (c, _), v in fake_db.docs.items() if c == "notes"]


def _reel_video_bundle():
    return ContentBundle(kind="text", text="Dal caption", images=["https://cdn/t.jpg"],
                         metadata={"caption": "Dal caption", "comments": ["1 cup dal"],
                                   "video_bytes": b"MP4", "video_mime": "video/mp4",
                                   "platform": "instagram"},
                         strategy="reel_video")


async def test_video_unreadable_degrades_to_thin_caption_note_not_failed_job(fake_db, monkeypatch):
    st = _wire(monkeypatch, fake_db, bundle=_reel_video_bundle(),
               video=VideoUnreadable("APIStatusError: 429 on every model"))
    res = await process.process_job("j", DummyRequest())
    assert res["status"] == "completed" and not res.get("salvaged")
    note = _notes(fake_db)[0]
    assert note["data"]["thin"] is True
    assert note["acquisition"] == "reel_video_thin"
    assert st["extract_calls"] == [("reel_video_thin", None)]
    assert "video_bytes" not in json.dumps(note, default=str)   # bytes never persisted


async def test_video_success_note_never_contains_video_bytes(fake_db, monkeypatch):
    note = NoteExtraction(content_type="Recipes", title="T", ai_summary="S",
                          data={"steps": ["x" * 60]})
    _wire(monkeypatch, fake_db, bundle=_reel_video_bundle(), existing=["recipe"], video=note)
    await process.process_job("j", DummyRequest())
    doc = _notes(fake_db)[0]
    assert doc["content_type"] == "recipe"                   # model slug snapped onto taxonomy
    assert "thin" not in doc["data"]
    assert all(not isinstance(v, bytes) for v in doc.values())


async def test_video_model_new_slug_respects_category_cap(fake_db, monkeypatch):
    monkeypatch.setattr(settings, "MAX_USER_CATEGORIES", 3)
    note = NoteExtraction(content_type="home-decor-ideas", title="T", ai_summary="S",
                          data={"steps": ["x" * 60]})
    st = _wire(monkeypatch, fake_db, bundle=_reel_video_bundle(),
               existing=["recipe", "decor", "travel"], video=note)
    await process.process_job("j", DummyRequest())
    assert _notes(fake_db)[0]["content_type"] == "decor"
    assert st["added"] == ["decor"]


async def test_video_model_slug_under_cap_may_grow_taxonomy(fake_db, monkeypatch):
    note = NoteExtraction(content_type="Street Food", title="T", ai_summary="S",
                          data={"steps": ["x" * 60]})
    _wire(monkeypatch, fake_db, bundle=_reel_video_bundle(), existing=["recipe"], video=note)
    await process.process_job("j", DummyRequest())
    assert _notes(fake_db)[0]["content_type"] == "street-food"


async def test_thin_caption_with_tiny_data_is_salvaged_as_bookmark(fake_db, monkeypatch):
    """A caption-only reel whose note data is under the 40-char gate becomes a bookmark (not a
    failed job). Documents behaviour: 'thin note' is not guaranteed — the salvage is."""
    async def tiny(url, b, ct, hint=None, **_):
        return NoteExtraction(content_type="recipe", title="T", ai_summary="S", data={"a": 1})
    b = ContentBundle(kind="text", text="cap", metadata={"thin": True, "caption": "cap"},
                      strategy="reel_caption")
    _wire(monkeypatch, fake_db, bundle=b, extract=tiny)
    res = await process.process_job("j", DummyRequest())
    assert res["status"] == "completed" and res.get("salvaged")


async def test_youtube_unreadable_runs_fallback_then_thin_description_note(fake_db, monkeypatch):
    calls = []

    async def extract(url, b, ct, hint=None, **_):
        calls.append(b.strategy)
        if b.strategy == "youtube_direct":
            raise VideoUnreadable("age-restricted")
        return NoteExtraction(content_type=ct or "summary", title="T", ai_summary="S",
                              data={"tldr": "x" * 60})

    async def fallback(url, bundle=None, **kw):
        return ContentBundle(kind="text", text="desc", images=bundle.images,
                             metadata={**bundle.metadata, "via": "description", "thin": True},
                             strategy="youtube_fallback")

    b = ContentBundle(kind="video_uri", video_uri="https://www.youtube.com/watch?v=aaaaaaaaaaa",
                      images=["https://i.ytimg.com/x.jpg"],
                      metadata={"title": "T", "platform": "youtube", "caption_tracks": []},
                      strategy="youtube_direct")
    _wire(monkeypatch, fake_db, bundle=b, extract=extract)
    monkeypatch.setattr(process.sources.youtube, "fallback", fallback)
    fake_db.docs[("jobs", "j")]["url"] = "https://www.youtube.com/watch?v=aaaaaaaaaaa"
    res = await process.process_job("j", DummyRequest())
    assert calls == ["youtube_direct", "youtube_fallback"]
    note = _notes(fake_db)[0]
    assert note["acquisition"] == "youtube_fallback" and note["data"]["thin"] is True
    assert res["status"] == "completed"


async def test_youtube_fallback_video_unreadable_also_degrades(fake_db, monkeypatch):
    """Fallback hands back an Apify mp4; the video model can't read it either → thin text note
    from the description, still completed."""
    calls = []

    async def extract(url, b, ct, hint=None, **_):
        calls.append(b.strategy)
        if b.strategy == "youtube_direct":
            raise VideoUnreadable("restricted")
        return NoteExtraction(content_type="summary", title="T", ai_summary="S",
                              data={"tldr": "x" * 60})

    async def fallback(url, bundle=None, **kw):
        return ContentBundle(kind="text", text="desc", metadata={"video_bytes": b"MP4",
                             "video_mime": "video/mp4", "caption": "desc"},
                             strategy="youtube_fallback_video")

    b = ContentBundle(kind="video_uri", video_uri="https://youtu.be/aaaaaaaaaaa",
                      metadata={"platform": "youtube"}, strategy="youtube_direct")
    _wire(monkeypatch, fake_db, bundle=b, extract=extract, video=VideoUnreadable("nope"))
    monkeypatch.setattr(process.sources.youtube, "fallback", fallback)
    res = await process.process_job("j", DummyRequest())
    assert calls == ["youtube_direct", "youtube_fallback_video_thin"]
    assert _notes(fake_db)[0]["data"]["thin"] is True and res["status"] == "completed"


async def test_duplicate_dispatch_is_409_and_runs_nothing(fake_db, monkeypatch):
    st = _wire(monkeypatch, fake_db, bundle=_reel_video_bundle())
    fake_db.docs[("jobs", "j")].update(status="processing",
                                       updated_at=datetime.now(timezone.utc))
    with pytest.raises(HTTPException) as e:
        await process.process_job("j", DummyRequest())
    assert e.value.status_code == 409
    assert st["video_calls"] == [] and _notes(fake_db) == []


async def test_completed_job_is_noop_no_acquire(fake_db, monkeypatch):
    _wire(monkeypatch, fake_db, bundle=_reel_video_bundle())

    async def boom(url):
        raise AssertionError("acquire must not run for a completed job")
    monkeypatch.setattr(process.sources, "acquire", boom)
    fake_db.docs[("jobs", "j")].update(status="completed", note_id="n1")
    res = await process.process_job("j", DummyRequest())
    assert res == {"status": "completed", "note_id": "n1"}


# ---------------------------------------------------------------- 5. download cap (no OOM)

def _mock_client(handler):
    def factory(**kw):
        kw.pop("follow_redirects", None)
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kw)
    return factory


async def test_download_streams_and_stops_at_cap_without_content_length(monkeypatch):
    monkeypatch.setattr(settings, "VIDEO_MAX_BYTES", 200_000)
    produced = {"n": 0}

    async def endless():
        for _ in range(10_000):          # 640 MB if fully read
            produced["n"] += 1
            yield b"\0" * 65536

    def handler(request):
        return httpx.Response(200, headers={"content-type": "video/mp4"}, content=endless())

    monkeypatch.setattr(sv, "guarded_async_client", _mock_client(handler))
    assert await sv.download_video("https://cdn.example/v.mp4") is None
    assert produced["n"] <= 5            # stopped right after crossing the cap


async def test_download_rejects_on_content_length_before_reading(monkeypatch):
    monkeypatch.setattr(settings, "VIDEO_MAX_BYTES", 1000)
    produced = {"n": 0}

    async def body():
        produced["n"] += 1
        yield b"\0" * 10

    def handler(request):
        return httpx.Response(200, headers={"content-length": "999999"}, content=body())

    monkeypatch.setattr(sv, "guarded_async_client", _mock_client(handler))
    assert await sv.download_video("https://cdn.example/v.mp4") is None
    assert produced["n"] == 0


@pytest.mark.parametrize("code", [403, 404, 410])
async def test_expired_cdn_link_is_none(monkeypatch, code):
    monkeypatch.setattr(sv, "guarded_async_client",
                        _mock_client(lambda r: httpx.Response(code)))
    assert await sv.download_video("https://scontent.cdninstagram.com/v.mp4") is None


async def test_download_never_sends_apify_token_to_a_cdn(monkeypatch):
    monkeypatch.setattr(settings, "APIFY_TOKEN", "tok_secret")
    seen = {}

    def handler(r):
        seen["auth"] = r.headers.get("authorization")
        return httpx.Response(200, content=b"MP4DATA")

    monkeypatch.setattr(sv, "guarded_async_client", _mock_client(handler))
    await sv.download_video("https://scontent.cdninstagram.com/v.mp4?x=api.apify.com")
    assert seen["auth"] is None, "token leaked to a non-Apify host via substring match"


# ---------------------------------------------------------------- 6. acq_cache

async def test_cache_older_than_6h_is_ignored(fake_db, monkeypatch):
    monkeypatch.setattr(acq_cache, "get_db", lambda: fake_db)
    url = "https://www.instagram.com/reel/X/"
    await acq_cache.put(url, {"caption": "c", "strategy": "reel_caption"})
    key = next(k for k in fake_db.docs if k[0] == "acq_cache")
    fake_db.docs[key]["cached_at"] = datetime.now(timezone.utc) - timedelta(hours=6, seconds=1)
    assert await acq_cache.get(url) is None
    fake_db.docs[key]["cached_at"] = datetime.now(timezone.utc) - timedelta(hours=5, minutes=59)
    assert (await acq_cache.get(url))["caption"] == "c"


async def test_cache_put_never_stores_bytes_or_unknown_keys(fake_db, monkeypatch):
    monkeypatch.setattr(acq_cache, "get_db", lambda: fake_db)
    await acq_cache.put("u", {"caption": "c", "video_bytes": b"x" * 10, "secret": "s",
                              "media_url": "https://cdn/v", "strategy": "reel_video"})
    doc = next(v for k, v in fake_db.docs.items() if k[0] == "acq_cache")
    assert set(doc) == {"caption", "media_url", "strategy", "cached_at", "expires_at"}


async def test_cache_get_db_raising_is_a_miss(monkeypatch):
    def boom():
        raise RuntimeError("no creds")
    monkeypatch.setattr(acq_cache, "get_db", boom)
    assert await acq_cache.get("u") is None
    await acq_cache.put("u", {"caption": "c"})   # must not raise either


async def test_cache_doc_with_bad_cached_at_is_a_miss(fake_db, monkeypatch):
    """A cache doc whose cached_at isn't a tz-aware datetime (naive datetime from a script, or
    a string) must be a miss, not a TypeError that bubbles out of social_video.acquire and
    drops an Instagram reel to the generic scraper."""
    monkeypatch.setattr(acq_cache, "get_db", lambda: fake_db)
    import hashlib
    key = hashlib.sha256(b"u").hexdigest()
    fake_db.seed("acq_cache", key, {"caption": "c", "cached_at": datetime.utcnow()})
    assert await acq_cache.get("u") is None


@pytest.fixture
def ladder(monkeypatch):
    st = {"cache": None, "puts": [], "apify": None, "apify_calls": 0,
          "downloads": [], "dead": set(), "og_calls": 0}

    async def cache_get(url):
        return st["cache"]

    async def cache_put(url, entry):
        st["puts"].append(dict(entry))

    async def fetch_capped(url):
        st["apify_calls"] += 1
        return st["apify"]

    async def download(u):
        st["downloads"].append(u)
        return None if u in st["dead"] else (b"MP4", "video/mp4")

    async def og(url):
        st["og_calls"] += 1
        return sv._blocked_bundle(url, sv._platform(url))

    async def images(urls):
        return [{"mime_type": "image/jpeg", "data": b"i"} for u in urls]

    monkeypatch.setattr(sv.acq_cache, "get", cache_get)
    monkeypatch.setattr(sv.acq_cache, "put", cache_put)
    monkeypatch.setattr(apify, "fetch_capped", fetch_capped)
    monkeypatch.setattr(sv, "download_video", download)
    monkeypatch.setattr(sv, "_caption_fallback", og)
    monkeypatch.setattr(sv, "_fetch_image_parts", images)
    return st


IG = "https://www.instagram.com/reel/ABC/"


async def test_expired_cached_media_reruns_full_ladder(ladder):
    ladder["cache"] = {"caption": "c", "media_url": "https://cdn/old", "strategy": "reel_video",
                       "via": "apify"}
    ladder["dead"].add("https://cdn/old")
    ladder["apify"] = {"video_url": "https://cdn/new", "caption": "c", "images": []}
    b = await sv.acquire(IG)
    assert b.strategy == "reel_video" and b.metadata["video_bytes"] == b"MP4"
    assert ladder["downloads"] == ["https://cdn/old", "https://cdn/new"]
    assert ladder["apify_calls"] == 1                              # ladder re-ran, once
    assert ladder["puts"][-1]["media_url"] == "https://cdn/new"   # cache refreshed


async def test_undownloadable_apify_video_is_cached_as_reel_video_and_reruns_apify(ladder):
    """BUG (cost): Apify returns a video URL that can't be downloaded (over 25 MB, 403). The note
    is thin, but the entry is cached with strategy=reel_video, so every re-extract inside 6 h
    sees an 'expired' video and re-runs the PAID Apify actor for the same dead file.
    Expected: a cache hit whose video was never obtainable doesn't trigger another Apify run."""
    ladder["apify"] = {"video_url": "https://cdn/huge", "caption": "c", "images": []}
    ladder["dead"].add("https://cdn/huge")
    b1 = await sv.acquire(IG)
    assert b1.metadata.get("thin") is True
    ladder["cache"] = ladder["puts"][-1]
    await sv.acquire(IG)
    assert ladder["apify_calls"] == 1, f"Apify ran {ladder['apify_calls']}x for one dead video"


async def test_no_video_anywhere_is_thin_reel_caption(ladder):
    ladder["apify"] = {"video_url": None, "caption": "A caption long enough", "images": []}
    b = await sv.acquire(IG)
    assert b.strategy == "reel_caption" and b.metadata["thin"] is True
    assert ladder["apify_calls"] == 1 and "video_bytes" not in b.metadata


async def test_apify_cap_reached_goes_to_og(ladder):
    ladder["apify"] = None              # fetch_capped returns None at the cap
    b = await sv.acquire(IG)
    assert ladder["apify_calls"] == 1 and ladder["og_calls"] == 1
    assert b.strategy == "private_or_blocked"
    assert ladder["puts"] == []          # nothing cached for a total miss


async def test_cached_thin_caption_blocks_ladder_for_6h(ladder):
    """Documents: a thin caption cached because Apify was capped stays thin for 6 h — a
    re-extract after the cap resets will NOT try Apify again until the entry expires."""
    ladder["cache"] = {"caption": "c", "strategy": "reel_caption", "via": "apify"}
    b = await sv.acquire(IG)
    assert b.metadata["thin"] is True and ladder["apify_calls"] == 0


# ---------------------------------------------------------------- 7. Apify slot accounting

@pytest.fixture
def slots(fake_db, monkeypatch):
    monkeypatch.setattr(firebase_mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(settings, "APIFY_TOKEN", "t")
    monkeypatch.setattr(settings, "APIFY_DAILY_GLOBAL_CAP", 2)
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return lambda: (fake_db.docs.get(("system", f"usage-{today}")) or {}).get("apify_count", 0)


async def test_slot_released_on_exception_inside_run(slots, monkeypatch):
    def run(actor, url):
        raise httpx.ReadTimeout("apify cold start")
    monkeypatch.setattr(apify, "_run", run)
    assert await apify.fetch_capped(IG) is None
    assert slots() == 0


async def test_slot_kept_on_success_and_cap_blocks_third_run(slots, monkeypatch):
    runs = []

    def run(actor, url):
        runs.append(url)
        return {"video_url": "v", "caption": "c"}
    monkeypatch.setattr(apify, "_run", run)
    assert await apify.fetch_capped(IG)
    assert await apify.fetch_capped(IG)
    assert await apify.fetch_capped(IG) is None
    assert slots() == 2 and len(runs) == 2


async def test_slot_released_on_empty_dataset(slots, monkeypatch):
    monkeypatch.setattr(apify, "_run", lambda a, u: None)
    assert await apify.fetch_capped(IG) is None
    assert slots() == 0


async def test_unconfigured_actor_reserves_nothing(slots, monkeypatch):
    monkeypatch.setattr(settings, "APIFY_FACEBOOK_ACTOR", "")
    assert await apify.fetch_capped("https://www.facebook.com/reel/1") is None
    assert slots() == 0


async def test_reservation_firestore_error_means_no_run(monkeypatch):
    def boom():
        raise RuntimeError("firestore down")
    monkeypatch.setattr(firebase_mod, "get_db", boom)
    monkeypatch.setattr(settings, "APIFY_TOKEN", "t")
    monkeypatch.setattr(apify, "_run", lambda a, u: pytest.fail("ran without a slot"))
    assert await apify.fetch_capped(IG) is None


# ---------------------------------------------------------------- 8. YouTube

@pytest.fixture
def ytstubs(monkeypatch):
    s = {"page": None, "oembed": None, "apify": None, "apify_calls": 0}

    async def watch(vid):
        if isinstance(s["page"], Exception) or s["page"] is None:
            raise s["page"] or RuntimeError("blocked")
        return s["page"]

    async def oembed(url):
        if s["oembed"] is None:
            raise RuntimeError("oembed down")
        return s["oembed"]

    async def fetch_capped(url):
        s["apify_calls"] += 1
        return s["apify"]

    async def transcript(tracks):
        return None

    monkeypatch.setattr(yt, "_watch_page", watch)
    monkeypatch.setattr(yt, "_oembed", oembed)
    monkeypatch.setattr(yt, "_fetch_transcript", transcript)
    monkeypatch.setattr(apify, "fetch_capped", fetch_capped)
    return s


YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


async def test_over_limit_goes_straight_to_fallback_no_direct(ytstubs):
    ytstubs["page"] = {"duration": yt.settings.YOUTUBE_MAX_DIRECT_SECONDS + 1, "title": "Long talk", "author": "A",
                       "description": "A long description of the talk " * 3,
                       "thumbnail": "https://i.ytimg.com/x.jpg", "tracks": []}
    b = await yt.acquire(YT)
    assert b.strategy == "youtube_fallback" and b.metadata["thin"] is True
    assert b.metadata["via"] == "description" and b.images


async def test_exactly_at_limit_still_direct(ytstubs):
    ytstubs["page"] = {"duration": yt.settings.YOUTUBE_MAX_DIRECT_SECONDS, "title": "T", "author": "A", "description": "",
                       "thumbnail": None, "tracks": []}
    assert (await yt.acquire(YT)).strategy == "youtube_direct"


async def test_fallback_without_any_metadata_must_not_feed_a_bare_url(ytstubs):
    """BUG (hallucination): watch page AND oEmbed blocked, no captions, Apify capped/empty.
    fallback() returns a text bundle whose ONLY content is 'Untitled' (or the URL), marked
    thin, and process.py sends it to the text model — which then writes a note from nothing.
    social_video explicitly refuses this ('NEVER text=url'). Expected: a metadata_only /
    unreachable bundle so process.py salvages a bookmark instead of extracting."""
    b = await yt.fallback(YT)
    assert ytstubs["apify_calls"] == 1
    assert b.kind == "metadata_only" or b.strategy == "unreachable", (
        f"fallback produced kind={b.kind} text={b.text!r} — model would invent a note")


async def test_restricted_fallback_apify_capped_uses_description(ytstubs):
    bundle = ContentBundle(kind="video_uri", video_uri=YT, images=["https://i/x.jpg"],
                           metadata={"title": "T", "description": "Real description " * 5,
                                     "platform": "youtube", "caption_tracks": []},
                           strategy="youtube_direct")
    b = await yt.fallback(YT, bundle)
    assert b.strategy == "youtube_fallback" and b.metadata["thin"] is True
    assert "caption_tracks" not in b.metadata and b.text.startswith("Real description")


# ---------------------------------------------------------------- 9. ingest duplicates

class _Req:
    def __init__(self, body: dict):
        self._b = json.dumps(body).encode()
        self.headers = {}

    async def body(self):
        return self._b


class _Tx:
    def __init__(self, db):
        self._db = db

    def set(self, ref, data, merge=False):
        base = self._db.docs.get(ref._key, {}) if merge else {}
        self._db.docs[ref._key] = {**base, **data}


@pytest.fixture
def ing(fake_db, monkeypatch):
    fake_db.transaction = lambda: _Tx(fake_db)
    monkeypatch.setattr(ingest_mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(ingest_mod.fs, "async_transactional", lambda f: f)
    monkeypatch.setattr(settings, "WORKER_SECRET", "s", raising=False)
    dispatched = []
    monkeypatch.setattr(ingest_mod, "enqueue_process_job", lambda jid: dispatched.append(jid))

    async def _ok(url):
        return None

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(ingest_mod, "assert_public_url_async", _ok)
    monkeypatch.setattr(ingest_mod, "touch_user_activity", _noop)
    monkeypatch.setattr(ingest_mod, "_redispatch_own_stale", _noop)
    return dispatched


def _usage_docs(fake_db):
    return [k for k in fake_db.docs if k[0] in ("usage", "system")]


async def test_duplicate_same_user_returns_completed_no_caps_no_dispatch(fake_db, ing):
    fake_db.seed("notes", "n1", {"user_id": "u", "source_url": "https://www.instagram.com/reel/ABC/"})
    out = await ingest_mod.ingest(_Req({"url": "https://www.instagram.com/reel/ABC/?igsh=zzz"}),
                                  user_id="u")
    assert out.status == "completed" and out.note_id == "n1"
    assert ing == [] and _usage_docs(fake_db) == []


async def test_duplicate_other_user_is_not_a_duplicate(fake_db, ing):
    fake_db.seed("notes", "n1", {"user_id": "other", "source_url": "https://www.instagram.com/reel/ABC/"})
    out = await ingest_mod.ingest(_Req({"url": "https://www.instagram.com/reel/ABC/"}), user_id="u")
    assert out.status == "pending" and len(ing) == 1


async def test_fallback_bookmark_is_not_a_duplicate(fake_db, ing):
    fake_db.seed("notes", "n1", {"user_id": "u", "source_url": "https://www.instagram.com/reel/ABC/",
                                 "is_fallback": True})
    out = await ingest_mod.ingest(_Req({"url": "https://www.instagram.com/reel/ABC/"}), user_id="u")
    assert out.status == "pending" and len(ing) == 1


async def test_reel_shared_twice_with_different_stkn_is_a_duplicate(fake_db, ing):
    """BUG (dedupe miss): real share links in phase0/ab/links.txt carry `?stkn=...` (an IG
    share token). canonical_url strips igsh/igshid but not stkn, so the same reel shared twice
    becomes two notes and two paid extractions. Expected: duplicate."""
    first = ingest_mod.IngestRequest(input_type="url", url=
                                     "https://www.instagram.com/reel/DdyvwuOq3vf/?stkn=AAA").url
    fake_db.seed("notes", "n1", {"user_id": "u", "source_url": first})
    out = await ingest_mod.ingest(
        _Req({"url": "https://www.instagram.com/reel/DdyvwuOq3vf/?stkn=BBB"}), user_id="u")
    assert out.status == "completed", f"stored {first!r}; second share was not deduped"


async def test_youtube_short_and_watch_url_same_video(fake_db, ing):
    """Low: youtube.com/shorts/ID vs watch?v=ID (and youtu.be/ID) are the same video but dedupe
    compares raw canonical strings. Documenting current behaviour (not deduped)."""
    fake_db.seed("notes", "n1", {"user_id": "u",
                                 "source_url": "https://youtube.com/shorts/JsEE5g_6IEw"})
    out = await ingest_mod.ingest(_Req({"url": "https://youtu.be/JsEE5g_6IEw"}), user_id="u")
    assert out.status == "pending"


# ---------------------------------------------------------------- 10. search

async def test_search_short_query_400(fake_db, monkeypatch):
    monkeypatch.setattr(search_mod, "get_db", lambda: fake_db)
    with pytest.raises(HTTPException) as e:
        await search_mod.search(q="  ab  ", user_id="u")
    assert e.value.status_code == 400


async def test_search_never_returns_other_users_notes(fake_db, monkeypatch):
    monkeypatch.setattr(search_mod, "get_db", lambda: fake_db)
    fake_db.transaction = lambda: _Tx(fake_db)
    monkeypatch.setattr(search_mod.fs, "async_transactional", lambda f: f)
    now = datetime.now(timezone.utc)
    fake_db.seed("notes", "mine", {"user_id": "u1", "title": "dal recipe", "embedding": [0.1],
                                   "created_at": now})
    fake_db.seed("notes", "theirs", {"user_id": "u2", "title": "dal recipe secret",
                                     "embedding": [0.1], "created_at": now,
                                     "data": {"private": "x"}})
    res = await search_mod.search(q="dal recipe", user_id="u1")
    assert [r["id"] for r in res["results"]] == ["mine"]
    assert all("data" not in r and "embedding" not in r for r in res["results"])


async def test_search_keyword_pass_projects_fields(fake_db, monkeypatch):
    monkeypatch.setattr(search_mod, "get_db", lambda: fake_db)
    fake_db.transaction = lambda: _Tx(fake_db)
    monkeypatch.setattr(search_mod.fs, "async_transactional", lambda f: f)
    from conftest import FakeCollection
    selected = []
    orig = FakeCollection.select

    def spy(self, fields):
        selected.append(list(fields))
        return orig(self, fields)

    monkeypatch.setattr(FakeCollection, "select", spy)
    await search_mod.search(q="anything", user_id="u1")
    assert selected and "data" not in selected[0] and "embedding" not in selected[0]


# ---------------------------------------------------------------- 11. firestore.rules (static)

RULES = (__import__("pathlib").Path(__file__).resolve().parents[2] / "infra" / "firestore.rules")


@pytest.mark.parametrize("coll", ["acq_cache", "shortcut_tokens", "usage", "system", "tmdb_cache"])
def test_rules_deny_backend_only_collections(coll):
    import re
    text = RULES.read_text()
    assert re.search(rf"match /{coll}/\{{\w+\}}\s*\{{\s*allow read, write: if false;\s*\}}", text)


def test_rules_have_no_public_note_read():
    text = RULES.read_text()
    block = text.split("match /notes/{noteId}")[1].split("}")[0]
    assert "is_public" not in block and "if true" not in block
    assert "request.auth.uid == resource.data.user_id" in block


def test_rules_users_doc_is_not_fully_client_writable():
    """RISK: users/{uid} is owner read+WRITE with no field restriction, so a signed-in client
    can rewrite its own lifetime_cost_usd / lifetime_* counters (admin dashboard) and — once
    Phase 3 lands — `plan: "pro"` and stripe_customer_id. Expected: writes limited to safe
    fields (display prefs, region, categories) or denied."""
    text = RULES.read_text()
    block = text.split("match /users/{uid}")[1].split("}")[0]
    assert "allow read, write: if request.auth != null && request.auth.uid == uid;" not in block

