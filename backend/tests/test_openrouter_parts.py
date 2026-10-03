"""OpenRouter request shaping in GeminiService._chat / extract: model routing, content parts,
provider pinning, JSON mode, web plugin, and the YouTube → text fallback. No network: the sync
client's `chat.completions.create` is faked and every call's kwargs are captured."""
import json

import pytest

from conftest import chat_resp
from config import settings
from models.note import ContentBundle
from services.gemini import JSON_SUFFIX, gemini_service

NOTE_JSON = json.dumps({"content_type": "x", "title": "T", "ai_summary": "S",
                        "cover_image_prompt": "", "data": {}})


@pytest.fixture
def calls(monkeypatch):
    """Capture every create() call; replies come from `calls.replies` (str or Exception)."""
    seen = _Calls()
    seen_replies: list = []

    def fake_create(**kwargs):
        seen.append(kwargs)
        reply = seen_replies.pop(0) if seen_replies else NOTE_JSON
        if isinstance(reply, Exception):
            raise reply
        return chat_resp(reply)

    monkeypatch.setattr(gemini_service.client.chat.completions, "create", fake_create)
    monkeypatch.setattr("services.gemini.time.sleep", lambda *_: None)
    seen.replies = seen_replies
    return seen


class _Calls(list):
    replies: list


def _bundle(**kw):
    base = dict(kind="text", text="body text", metadata={"title": "Vid", "description": "desc"},
                strategy="t")
    base.update(kw)
    return ContentBundle(**base)


def _user_parts(call):
    return call["messages"][-1]["content"]


def test_youtube_routes_to_youtube_model_with_video_part_and_provider_pin(calls):
    gemini_service.extract("https://youtu.be/abc", _bundle(kind="video_uri",
                           video_uri="https://www.youtube.com/watch?v=abc"), "summary")
    call = calls[0]
    assert call["model"] == settings.YOUTUBE_MODEL
    parts = _user_parts(call)
    assert parts[0] == {"type": "video_url",
                        "video_url": {"url": "https://www.youtube.com/watch?v=abc"}}
    assert parts[1]["type"] == "text" and "Analyze the attached video" in parts[1]["text"]
    prov = call["extra_body"]["provider"]
    assert prov["order"] == ["google-ai-studio"] and prov["allow_fallbacks"] is False
    assert prov["require_parameters"] is True
    assert call["response_format"] == {"type": "json_object"}
    assert call["temperature"] == 0.2


def test_images_route_to_vision_model_as_data_urls(calls):
    b = _bundle(image_parts=[{"mime_type": "image/png", "data": b"\x89PNG"},
                             {"data": b"jpg"}])
    gemini_service.extract("https://instagram.com/p/x", b, "recipe")
    call = calls[0]
    assert call["model"] == settings.VISION_MODEL
    parts = _user_parts(call)
    assert parts[0]["type"] == "text" and "2 images from the post" in parts[0]["text"]
    assert parts[1]["image_url"]["url"] == "data:image/png;base64,iVBORw=="
    assert parts[2]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    # Qwen VL has no reasoning mode → the param is not sent (would starve require_parameters).
    assert "reasoning" not in call["extra_body"]


def test_plain_text_routes_to_text_model_as_string_content(calls):
    gemini_service.extract("https://example.com", _bundle(), "summary")
    call = calls[0]
    assert call["model"] == settings.TEXT_MODEL
    assert isinstance(_user_parts(call), str)
    assert call["extra_body"]["reasoning"] == {"enabled": False}
    assert "order" not in call["extra_body"]["provider"]


def test_gcs_video_uri_is_treated_as_absent(calls):
    gemini_service.extract("https://instagram.com/reel/x",
                           _bundle(kind="video_uri", video_uri="gs://bucket/v.mp4"), "recipe")
    call = calls[0]
    assert call["model"] == settings.TEXT_MODEL
    assert isinstance(_user_parts(call), str)
    assert "Analyze the attached video" not in _user_parts(call)


def test_youtube_failures_fall_back_to_text_model_without_video(calls):
    calls.replies.extend([RuntimeError("video 400"), RuntimeError("video 400")])
    out = gemini_service.extract("https://youtu.be/abc", _bundle(
        kind="video_uri", video_uri="https://youtu.be/abc"), "summary")
    assert out.title == "T" and out.content_type == "summary"
    assert [c["model"] for c in calls] == [settings.YOUTUBE_MODEL, settings.YOUTUBE_MODEL,
                                           settings.TEXT_MODEL]
    last = calls[2]
    assert isinstance(_user_parts(last), str)
    assert "Source title: Vid" in _user_parts(last) and "desc" in _user_parts(last)
    assert "order" not in last["extra_body"]["provider"]


def test_text_route_failing_twice_raises_without_fallback(calls):
    calls.replies.extend([RuntimeError("a"), RuntimeError("b")])
    with pytest.raises(RuntimeError, match="b"):
        gemini_service.extract("https://example.com", _bundle(), "summary")
    assert len(calls) == 2


def test_json_mode_appends_suffix_and_omits_temperature_when_none(calls):
    calls.replies.append('{"content_type": "recipe"}')
    gemini_service._chat(settings.LITE_MODEL, "SYS", "hello")
    call = calls[0]
    assert call["messages"][0] == {"role": "system", "content": "SYS" + JSON_SUFFIX}
    assert "json" in call["messages"][0]["content"].lower()
    assert "temperature" not in call
    assert call["response_format"] == {"type": "json_object"}


def test_web_plugin_without_response_format(calls):
    calls.replies.append("Some facts.")
    out = gemini_service._web_research("EUR to USD")
    assert out == "Some facts."
    call = calls[0]
    assert call["extra_body"]["plugins"] == [{"id": "web", "max_results": 3}]
    assert "response_format" not in call
    assert "provider" not in call["extra_body"]  # no require_parameters outside JSON mode
    assert call["messages"][0]["role"] == "user"  # empty system prompt → no system message
    assert call["temperature"] == 0.2


def test_chat_returns_empty_string_for_null_content(calls):
    calls.replies.append(None)
    assert gemini_service._chat(settings.TEXT_MODEL, "S", "t", json=False) == ""


def test_extract_near_deadline_makes_no_third_call(calls):
    import time
    calls.replies += [RuntimeError("a"), RuntimeError("b"), NOTE_JSON]
    with pytest.raises(RuntimeError):
        gemini_service.extract("https://youtu.be/x", _bundle(video_uri="https://youtu.be/x"),
                               "summary", deadline=time.monotonic() + 14)
    assert len(calls) == 1 and calls[0]["timeout"] == 15  # <15 s left: no further attempts
