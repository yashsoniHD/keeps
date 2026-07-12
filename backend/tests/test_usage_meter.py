"""Gemini token metering: thinking-token accounting, contextvar isolation, tier split."""
import pytest

import services.firebase as fb_mod
from config import settings
from services.usage_meter import UsageMeter, record_usage, start_metering


class FakeUsageMeta:
    def __init__(self, prompt, candidates, thoughts=0):
        self.prompt_token_count = prompt
        self.candidates_token_count = candidates
        self.thoughts_token_count = thoughts


class FakeResponse:
    def __init__(self, usage_metadata):
        self.usage_metadata = usage_metadata


def test_record_usage_includes_thinking_tokens():
    meter = start_metering()
    record_usage("gemini-3.5-flash", FakeResponse(FakeUsageMeta(100, 40, thoughts=60)))
    # output = candidates(40) + thoughts(60); thinking tokens must NOT be dropped.
    assert meter.by_model["gemini-3.5-flash"] == [100, 100]
    assert meter.calls == 1


def test_record_usage_is_noop_without_metering():
    # No start_metering() in this context → record silently does nothing (never raises).
    record_usage("gemini-3.5-flash", FakeResponse(FakeUsageMeta(10, 10)))


def test_record_usage_tolerates_missing_metadata():
    start_metering()
    record_usage("gemini-3.5-flash", FakeResponse(None))  # no usage_metadata
    # A response object without the attribute at all must also be safe.
    record_usage("gemini-3.5-flash", object())


def test_record_usage_tracks_audio_modality_as_input_subset():
    meter = start_metering()
    # A text call and an audio call on the same model: by_model input is the SUM of both,
    # while audio_input_tokens() is just the audio call's input (a subset of that total).
    record_usage(settings.GEMINI_MODEL, FakeResponse(FakeUsageMeta(100, 40)))
    record_usage(settings.GEMINI_MODEL, FakeResponse(FakeUsageMeta(200, 30)), modality="audio")
    assert meter.by_model[settings.GEMINI_MODEL] == [300, 70]  # 100+200 in, 40+30 out
    assert meter.audio_input_tokens() == 200  # only the audio call's input
    # Default modality records no audio subtotal.
    assert meter.audio_in_by_model == {settings.GEMINI_MODEL: 200}


def test_meter_accumulates_across_models():
    meter = start_metering()
    record_usage(settings.GEMINI_MODEL, FakeResponse(FakeUsageMeta(100, 50)))
    record_usage(settings.GEMINI_MODEL, FakeResponse(FakeUsageMeta(20, 10)))
    record_usage(settings.GEMINI_LITE_MODEL, FakeResponse(FakeUsageMeta(5, 3)))
    assert meter.by_model[settings.GEMINI_MODEL] == [120, 60]
    assert meter.by_model[settings.GEMINI_LITE_MODEL] == [5, 3]
    assert meter.calls == 3


async def test_flush_usage_splits_tiers_and_writes_increments(monkeypatch):
    """flush_usage writes lifetime counters (users doc) + global daily (system doc),
    splitting main vs lite token totals so cost can use each model's price."""
    writes: list[tuple[tuple[str, str], dict]] = []

    class FakeRef:
        def __init__(self, key):
            self._key = key

        async def set(self, data, merge=False):
            writes.append((self._key, data))

    class FakeCol:
        def __init__(self, name):
            self.name = name

        def document(self, doc_id):
            return FakeRef((self.name, doc_id))

    class FakeDb:
        def collection(self, name):
            return FakeCol(name)

    monkeypatch.setattr(fb_mod, "get_db", lambda: FakeDb())

    meter = UsageMeter()
    meter.add(settings.GEMINI_MODEL, 100, 200)
    meter.add(settings.GEMINI_LITE_MODEL, 10, 5)
    meter.calls = 2

    await fb_mod.flush_usage("u123", meter)

    by_collection = {key[0]: data for key, data in writes}
    assert "users" in by_collection and "system" in by_collection

    users_doc = by_collection["users"]
    # Increment objects carry the delta; firestore stores it on the transform.
    assert users_doc["lifetime_tokens_in_main"].value == 100
    assert users_doc["lifetime_tokens_out_main"].value == 200
    assert users_doc["lifetime_tokens_in_lite"].value == 10
    assert users_doc["lifetime_tokens_out_lite"].value == 5
    assert users_doc["lifetime_ai_calls"].value == 2


async def test_flush_usage_noop_when_no_calls(monkeypatch):
    called = False

    def boom():
        nonlocal called
        called = True
        raise AssertionError("get_db must not be touched for an empty meter")

    monkeypatch.setattr(fb_mod, "get_db", boom)
    await fb_mod.flush_usage("u123", UsageMeter())  # calls == 0
    assert called is False
