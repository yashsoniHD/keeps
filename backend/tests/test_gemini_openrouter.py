"""OpenRouter request shaping + parsing in GeminiService: model chains (`models` fallback),
routing, content parts, provider pinning, max_tokens, tolerant JSON + the nudge retry, timeout
fallback, VideoUnreadable, and rules-first classify. No network: the sync client's
`chat.completions.create` is faked and every call's kwargs are captured."""
import json
from types import SimpleNamespace

import httpx
import openai
import pytest

from conftest import chat_resp
from config import settings
from models.note import ContentBundle
from services import gemini
from services.gemini import JSON_SUFFIX, VideoUnreadable, gemini_service, parse_json
from services.usage_meter import start_metering

NOTE = {"content_type": "x", "title": "T", "ai_summary": "S", "data": {}}
NOTE_JSON = json.dumps(NOTE)


class _Calls(list):
    replies: list


@pytest.fixture
def calls(monkeypatch):
    """Capture every create() call; replies come from `calls.replies` (str, Exception, or a
    prebuilt response object)."""
    # This suite exercises the legacy transport/JSON-repair contract; document stages
    # and their routing are covered separately in test_note_document.py.
    monkeypatch.setattr(settings, "NOTE_DOCUMENTS_ENABLED", False)
    seen = _Calls()
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


def _bundle(**kw):
    base = dict(kind="text", text="body text", metadata={"title": "Vid", "description": "desc"},
                strategy="t")
    base.update(kw)
    return ContentBundle(**base)


def _chain_param(chain):
    """`models` is only sent for a real chain (more than one model)."""
    return chain if len(chain) > 1 else None


def _user_parts(call):
    return call["messages"][-1]["content"]


# ---------- extract routing ----------

def test_text_routes_to_text_chain_with_models_fallback(calls):
    b = _bundle()
    gemini_service.extract("https://example.com", b, "summary")
    call = calls[0]
    assert call["model"] == settings.TEXT_MODELS[0]
    assert call["extra_body"].get("models") == _chain_param(settings.TEXT_MODELS)
    assert "reasoning" not in call["extra_body"]
    assert "provider" not in call["extra_body"]  # no require_parameters: keeps free models in
    assert call["response_format"] == {"type": "json_object"}
    assert call["max_tokens"] == gemini.MAX_TOKENS_NOTE
    assert isinstance(_user_parts(call), str)
    assert b.metadata["model"] == settings.TEXT_MODELS[0]


def test_images_route_to_image_chain_as_data_urls(calls):
    b = _bundle(image_parts=[{"mime_type": "image/png", "data": b"\x89PNG"}, {"data": b"jpg"}])
    gemini_service.extract("https://instagram.com/p/x", b, "recipe")
    call = calls[0]
    assert call["model"] == settings.IMAGE_MODELS[0]
    assert call["extra_body"].get("models") == _chain_param(settings.IMAGE_MODELS)
    parts = _user_parts(call)
    assert parts[0]["type"] == "text" and "2 images from the post" in parts[0]["text"]
    assert parts[1]["image_url"]["url"] == "data:image/png;base64,iVBORw=="
    assert parts[2]["image_url"]["url"].startswith("data:image/jpeg;base64,")


def test_youtube_one_attempt_pinned_to_google(calls):
    gemini_service.extract("https://youtu.be/abc", _bundle(
        kind="video_uri", video_uri="https://www.youtube.com/watch?v=abc"), "summary")
    assert len(calls) == 1
    call = calls[0]
    assert call["model"] == settings.YOUTUBE_MODELS[0]
    parts = _user_parts(call)
    assert parts[0] == {"type": "video_url",
                        "video_url": {"url": "https://www.youtube.com/watch?v=abc"}}
    assert "Analyze the attached video" in parts[1]["text"]
    assert call["extra_body"]["provider"] == {"order": ["google-ai-studio"],
                                              "allow_fallbacks": False}


def test_youtube_failure_raises_video_unreadable_without_text_fallback(calls):
    calls.replies.append(RuntimeError("video 400"))
    with pytest.raises(VideoUnreadable, match="video 400"):
        gemini_service.extract("https://youtu.be/abc", _bundle(
            kind="video_uri", video_uri="https://youtu.be/abc"), "summary")
    assert len(calls) == 1


def test_gcs_video_uri_is_treated_as_absent(calls):
    gemini_service.extract("https://instagram.com/reel/x",
                           _bundle(kind="video_uri", video_uri="gs://bucket/v.mp4"), "recipe")
    assert calls[0]["model"] == settings.TEXT_MODELS[0]


def test_content_type_none_lets_model_pick_with_any_type_prompt(calls):
    calls.replies.append(json.dumps({**NOTE, "content_type": "Home Decor"}))
    out = gemini_service.extract("https://example.com", _bundle(), None)
    assert out.content_type == "home-decor"
    assert calls[0]["messages"][0]["content"].startswith(gemini.ANY_TYPE_PROMPT)


def test_given_content_type_is_enforced(calls):
    calls.replies.append(json.dumps({**NOTE, "content_type": "other"}))
    assert gemini_service.extract("https://e.com", _bundle(), "recipe").content_type == "recipe"


def test_text_failure_propagates_single_call(calls):
    calls.replies.append(RuntimeError("boom"))
    with pytest.raises(RuntimeError, match="boom"):
        gemini_service.extract("https://example.com", _bundle(), "summary")
    assert len(calls) == 1  # transient retries belong to process_job, not here


# ---------- tolerant JSON + nudge ----------

def test_parse_json_repairs_fences_think_and_prose():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('<think>{"no": 0}</think>Sure! {"a": 2} hope that helps') == {"a": 2}
    with pytest.raises(ValueError):
        parse_json("no json here")


def test_bad_json_nudges_with_only_the_bad_reply(calls):
    bad = "Here you go: {title: T"  # unrepairable
    calls.replies += [bad, NOTE_JSON]
    out = gemini_service.extract("https://example.com", _bundle(text="SECRET PAYLOAD"), "summary")
    assert out.title == "T" and len(calls) == 2
    nudge = calls[1]
    assert nudge["model"] == settings.TEXT_MODELS[0]
    assert _user_parts(nudge) == bad  # payload NOT re-sent
    assert "not valid JSON" in nudge["messages"][0]["content"]


def test_schema_invalid_json_also_nudges(calls):
    calls.replies += ['{"title": "only"}', NOTE_JSON]
    assert gemini_service.extract("https://e.com", _bundle(), "summary").title == "T"


def test_empty_reply_raises_without_nudge(calls):
    calls.replies.append("")
    with pytest.raises(ValueError, match="empty reply"):
        gemini_service.extract("https://e.com", _bundle(), "summary")
    assert len(calls) == 1


# ---------- _chat details ----------

def test_json_mode_appends_suffix_and_omits_temperature_when_none(calls):
    calls.replies.append('{"content_type": "recipe"}')
    gemini_service._chat(settings.CLASSIFY_MODELS, "SYS", "hello")
    call = calls[0]
    assert call["messages"][0] == {"role": "system", "content": "SYS" + JSON_SUFFIX}
    assert "temperature" not in call


def test_single_model_chain_omits_models_param(calls):
    gemini_service._chat(["only/model"], "S", "t")
    assert "models" not in calls[0]["extra_body"]


def test_records_model_that_actually_answered(calls):
    meter = start_metering()
    resp = chat_resp(NOTE_JSON, usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1,
                                                      cost=0.002))
    resp.model = "deepseek/deepseek-v3.2"  # free model 429'd; paid fallback answered
    calls.replies.append(resp)
    _, used = gemini_service._chat(settings.TEXT_MODELS, "S", "t")
    assert used == "deepseek/deepseek-v3.2"
    assert meter.models == {"deepseek/deepseek-v3.2": 1} and meter.last_model == used


def test_client_timeout_retries_on_rest_of_chain(calls):
    calls.replies += [_timeout(), NOTE_JSON]
    _, used = gemini_service._chat(["free/a:free", "paid/b"], "S", "t", timeout=50)
    assert [c["model"] for c in calls] == ["free/a:free", "paid/b"]
    assert "models" not in calls[1]["extra_body"]
    assert used == "paid/b"


def test_client_timeout_on_last_model_raises(calls):
    calls.replies.append(_timeout())
    with pytest.raises(openai.APITimeoutError):
        gemini_service._chat(["paid/b"], "S", "t")


def test_client_timeout_no_retry_when_budget_spent(calls):
    import time
    calls.replies.append(_timeout())
    token = gemini.job_deadline.set(time.monotonic() + 10)
    try:
        with pytest.raises(openai.APITimeoutError):
            gemini_service._chat(["a", "b"], "S", "t")
    finally:
        gemini.job_deadline.reset(token)
    assert len(calls) == 1


def test_web_plugin_without_response_format(calls):
    calls.replies.append("Some facts.")
    assert gemini_service._search_grounded_page("https://amazon.in/x") == "Some facts."
    call = calls[0]
    assert call["extra_body"]["plugins"] == [{"id": "web", "max_results": 3}]
    assert "response_format" not in call
    assert call["messages"][0]["role"] == "user"
    assert call["max_tokens"] == gemini.MAX_TOKENS_GROUNDED


def test_search_grounded_not_found_is_none(calls):
    calls.replies.append("NOT_FOUND")
    assert gemini_service._search_grounded_page("https://amazon.in/x") is None


def test_chat_returns_empty_string_for_null_content(calls):
    calls.replies.append(None)
    assert gemini_service._chat(["m"], "S", "t", json=False)[0] == ""


# ---------- extract_from_video ----------

async def test_video_sends_base64_data_url_on_video_chain(calls):
    out = await gemini_service.extract_from_video(b"\x00\x01mp4", "video/mp4", "cap text",
                                                  ["nice!", " ", "where?"], "recipe")
    assert out.content_type == "recipe"
    call = calls[0]
    assert call["model"] == settings.VIDEO_MODELS[0]
    assert call["extra_body"].get("models") == _chain_param(settings.VIDEO_MODELS)
    assert "reasoning" not in call["extra_body"]
    assert call["timeout"] == settings.VIDEO_CALL_TIMEOUT_S
    parts = _user_parts(call)
    assert parts[0] == {"type": "video_url", "video_url": {"url": "data:video/mp4;base64,AAFtcDQ="}}
    text = parts[1]["text"]
    assert "cap text" in text and "- nice!" in text and "- where?" in text
    assert "SEEN" in text and "HEARD" in text
    assert call["messages"][0]["content"].startswith(gemini.TYPE_PROMPTS["recipe"])


async def test_video_no_hint_model_picks_type(calls):
    calls.replies.append(json.dumps({**NOTE, "content_type": "Workout"}))
    out = await gemini_service.extract_from_video(b"v", "video/mp4", "", [], None)
    assert out.content_type == "workout"


async def test_video_api_failure_raises_video_unreadable(calls):
    calls.replies.append(RuntimeError("413 too large"))
    with pytest.raises(VideoUnreadable, match="413"):
        await gemini_service.extract_from_video(b"v", "video/mp4", "", [], None)


async def test_video_over_cap_raises_without_calling(calls, monkeypatch):
    monkeypatch.setattr(settings, "VIDEO_MAX_BYTES", 3)
    with pytest.raises(VideoUnreadable):
        await gemini_service.extract_from_video(b"1234", "video/mp4", "", [], None)
    assert calls == []


async def test_video_bad_json_nudges_without_resending_video(calls):
    calls.replies += ["garbage", NOTE_JSON]
    await gemini_service.extract_from_video(b"v", "video/mp4", "", [], "recipe")
    assert _user_parts(calls[1]) == "garbage"


# ---------- rules-first classify ----------

@pytest.mark.parametrize("url,bundle_kw,expected", [
    ("https://www.amazon.in/dp/B0X", {}, "product"),
    ("https://flipkart.com/p/x", {}, "product"),
    ("https://blog.example/curry", {"structured": {"@graph": [{"@type": ["Recipe"]}]}}, "recipe"),
    ("https://shop.example/x", {"structured": {"@type": "Product"}}, "product"),
])
async def test_rules_decide_without_model(calls, url, bundle_kw, expected):
    assert await gemini_service.classify(url, _bundle(**bundle_kw), []) == expected
    assert calls == []


@pytest.mark.parametrize("url,bundle_kw", [
    ("https://www.youtube.com/watch?v=x", {}),
    ("https://youtu.be/x", {}),
    ("https://www.instagram.com/reel/abc/", {}),
    ("https://www.tiktok.com/@a/video/1", {}),
    ("https://example.com/whatever", {"strategy": "reel_caption"}),
])
async def test_video_sources_return_none(calls, url, bundle_kw):
    assert await gemini_service.classify(url, _bundle(**bundle_kw), []) is None
    assert calls == []


async def test_note_hint_skips_rules_and_asks_model(calls):
    calls.replies.append('{"content_type": "workout"}')
    slug = await gemini_service.classify("https://www.instagram.com/reel/abc/", _bundle(), [],
                                         note_hint="save as a workout")
    assert slug == "workout"
    call = calls[0]
    assert call["model"] == settings.CLASSIFY_MODELS[0]
    assert call["max_tokens"] == gemini.MAX_TOKENS_CLASSIFY


async def test_rule_slug_matches_existing_plural(calls):
    assert await gemini_service.classify("https://amazon.com/x", _bundle(), ["products"]) == "products"


async def test_unrepairable_classify_reply_defaults_to_summary(calls):
    calls.replies.append("nope")
    assert await gemini_service.classify("https://example.com/a", _bundle(), []) == "summary"


async def test_instagram_post_is_not_a_video_source(calls):
    calls.replies.append('{"content_type": "recipe"}')
    assert await gemini_service.classify("https://www.instagram.com/p/abc/", _bundle(), []) == "recipe"
    assert len(calls) == 1


# ---------- review fixes: categories, video budget, wall clock ----------

import time  # noqa: E402


def _with_deadline(seconds_left):
    return gemini.job_deadline.set(time.monotonic() + seconds_left)


async def test_video_no_hint_lists_user_categories(calls):
    await gemini_service.extract_from_video(b"v", "video/mp4", "", [], None,
                                            categories=["recipes", "travel"])
    assert "User's existing categories: recipes, travel" in _user_parts(calls[0])[1]["text"]


async def test_video_with_hint_omits_categories(calls):
    await gemini_service.extract_from_video(b"v", "video/mp4", "", [], "recipe",
                                            categories=["recipes"])
    assert "existing categories" not in _user_parts(calls[0])[1]["text"]


async def test_video_categories_none_says_none_yet(calls):
    await gemini_service.extract_from_video(b"v", "video/mp4", "", [], None)
    assert "User's existing categories: none yet" in _user_parts(calls[0])[1]["text"]


def test_extract_none_type_lists_categories_and_cap_rule(calls, monkeypatch):
    monkeypatch.setattr(settings, "MAX_USER_CATEGORIES", 2)
    gemini_service.extract("https://youtu.be/a", _bundle(video_uri="https://youtu.be/a"), None,
                           categories=["a", "b"])
    call = calls[0]
    assert "User's existing categories: a, b" in _user_parts(call)[1]["text"]
    assert gemini.CATEGORY_CAP_RULE.strip() in call["messages"][0]["content"]


async def test_video_timeout_leaves_60s_reserve(calls):
    token = _with_deadline(150)
    try:
        await gemini_service.extract_from_video(b"v", "video/mp4", "", [], None)
    finally:
        gemini.job_deadline.reset(token)
    assert 89 < calls[0]["timeout"] <= 90  # min(120, 150 - 60)


async def test_video_skipped_under_75s_budget(calls):
    token = _with_deadline(70)
    try:
        with pytest.raises(VideoUnreadable, match="budget"):
            await gemini_service.extract_from_video(b"v", "video/mp4", "", [], None)
    finally:
        gemini.job_deadline.reset(token)
    assert calls == []


def test_youtube_skipped_under_75s_budget_and_capped_otherwise(calls):
    b = _bundle(video_uri="https://youtu.be/a")
    with pytest.raises(VideoUnreadable):
        gemini_service.extract("https://youtu.be/a", b, "summary", deadline=time.monotonic() + 60)
    assert calls == []
    gemini_service.extract("https://youtu.be/a", b, "summary", deadline=time.monotonic() + 100)
    assert 39 < calls[0]["timeout"] <= 40


def test_wall_clock_timeout_fires_despite_slow_reply(monkeypatch):
    """A reply trickling past the deadline (keep-alive whitespace) is abandoned at the wall
    clock and the rest of the chain is tried."""
    seen = []

    def fake_create(**kw):
        seen.append(kw["model"])
        if kw["model"] == "slow:free":
            time.sleep(1.0)
        return chat_resp(NOTE_JSON)

    monkeypatch.setattr(gemini_service.client.chat.completions, "create", fake_create)
    t0 = time.monotonic()
    _, used = gemini_service._chat(["slow:free", "fast"], "S", "t", timeout=0.2)
    assert used == "fast" and seen == ["slow:free", "fast"]
    assert time.monotonic() - t0 < 0.9


def test_wall_clock_timeout_on_last_model_raises_api_timeout(monkeypatch):
    monkeypatch.setattr(gemini_service.client.chat.completions, "create",
                        lambda **kw: time.sleep(1.0))
    with pytest.raises(openai.APITimeoutError):
        gemini_service._chat(["slow"], "S", "t", timeout=0.1)


# ---------- error-shaped 200s, truncation, thin sources, demoted defaults ----------

def test_default_chains_three_models():
    """2026-10-06 policy: three models. Gemini only reads YouTube URLs; qwen omni (hears audio)
    for every other medium; deepseek for all text. No free heads."""
    assert settings.YOUTUBE_MODELS == ["google/gemini-2.5-flash-lite"]
    assert settings.VIDEO_MODELS == settings.IMAGE_MODELS == ["qwen/qwen3.8-omni-flash"]
    assert settings.TEXT_MODELS == settings.CLASSIFY_MODELS == ["deepseek/deepseek-v3.2"]
    assert len({m for c in (settings.VIDEO_MODELS, settings.YOUTUBE_MODELS, settings.IMAGE_MODELS,
                            settings.TEXT_MODELS, settings.CLASSIFY_MODELS) for m in c}) == 3


def test_error_shaped_200_moves_to_next_model(calls):
    calls.replies += [SimpleNamespace(error={"code": 502, "message": "provider down"},
                                      choices=None, usage=None), NOTE_JSON]
    _, used = gemini_service._chat(["a:free", "b"], "S", "t")
    assert used == "b" and [c["model"] for c in calls] == ["a:free", "b"]


def test_empty_choices_on_last_model_raises_never_empty_string(calls):
    calls.replies.append(SimpleNamespace(choices=[], usage=None))
    with pytest.raises(gemini.ProviderError, match="no choices"):
        gemini_service._chat(["b"], "S", "t")


def test_error_shaped_200_on_video_remains_transient(calls):
    calls.replies.append(SimpleNamespace(error={"message": "bad video"}, choices=None, usage=None))
    with pytest.raises(gemini.ProviderError, match="bad video"):
        gemini_service._extract_from_video(b"v", "video/mp4", "", [], None)


def test_gemini_json_fences_parse_without_nudge(calls):
    calls.replies.append("```json\n" + NOTE_JSON + "\n```")
    assert gemini_service.extract("https://e.com", _bundle(), "summary").title == "T"
    assert len(calls) == 1


def test_truncated_looping_reply_fails_without_nudge(calls):
    resp = chat_resp('{"title": "T", "data": {"x": "ok ok ok ok ok ok')
    resp.choices[0].finish_reason = "length"
    calls.replies.append(resp)
    with pytest.raises(ValueError, match="max_tokens"):
        gemini_service.extract("https://e.com", _bundle(), "summary")
    assert len(calls) == 1


def test_truncated_but_parseable_reply_is_kept(calls):
    resp = chat_resp(NOTE_JSON)
    resp.choices[0].finish_reason = "length"
    calls.replies.append(resp)
    assert gemini_service.extract("https://e.com", _bundle(), "summary").title == "T"


@pytest.mark.parametrize("kw", [{"metadata": {"thin": True}}, {"strategy": "reel_video_thin"}])
def test_thin_bundle_gets_caption_only_rule(calls, kw):
    gemini_service.extract("https://instagram.com/reel/x", _bundle(**kw), "place")
    prompt = _user_parts(calls[0])
    assert gemini.THIN_RULE in prompt
    assert "NEVER turn it into a day-by-day itinerary" in prompt


def test_normal_bundle_has_no_thin_rule(calls):
    gemini_service.extract("https://e.com", _bundle(), "summary")
    assert gemini.THIN_RULE not in _user_parts(calls[0])


@pytest.mark.parametrize("youtube", [False, True])
@pytest.mark.parametrize("status", [429, 503])
def test_video_transient_status_propagates_for_worker_retry(calls, youtube, status):
    response = httpx.Response(status, request=httpx.Request("POST", "https://openrouter.ai"))
    error = openai.APIStatusError("provider unavailable", response=response, body={})
    calls.replies.append(error)
    with pytest.raises(openai.APIStatusError):
        if youtube:
            gemini_service.extract("https://youtu.be/x", _bundle(
                kind="video_uri", video_uri="https://youtu.be/x", strategy="youtube_direct"), None)
        else:
            gemini_service._extract_from_video(b"v", "video/mp4", "caption", [], None)


@pytest.mark.parametrize("sources,thin", [(["caption", "comment"], True), (["video", "caption"], False)])
def test_video_marks_actual_metadata_only_evidence(calls, sources, thin):
    note = {**NOTE, "data": {"_evidence": [{"source": src, "text": "detail"} for src in sources]}}
    calls.replies.append(json.dumps(note))
    result = gemini_service._extract_from_video(b"v", "video/mp4", "caption", [], None)
    assert bool(result.data.get("thin")) is thin
    if thin:
        assert result.data["_quality"]["media_coverage"] == "caption_only"
