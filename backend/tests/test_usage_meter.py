"""AI usage metering: OpenRouter usage/cost accounting, contextvar isolation, tier split."""
import pytest

import services.firebase as fb_mod
from config import settings
from services.usage_meter import UsageMeter, _tier_price, record_usage, start_metering


class FakeUsage:
    def __init__(self, prompt, completion=0, cost=None):
        self.prompt_tokens = prompt
        self.completion_tokens = completion
        if cost is not None:
            self.cost = cost


class FakeResponse:
    def __init__(self, usage):
        self.usage = usage


def test_record_usage_reads_openai_usage_and_billed_cost():
    meter = start_metering()
    record_usage(settings.TEXT_MODEL, FakeResponse(FakeUsage(100, 40, cost=0.0123)))
    assert meter.by_model[settings.TEXT_MODEL] == [100, 40]
    assert meter.cost_usd == pytest.approx(0.0123)  # OpenRouter's billed cost wins
    assert meter.calls == 1


def test_record_usage_falls_back_to_tier_price_without_cost(monkeypatch):
    monkeypatch.setattr(settings, "PRICE_MAIN_IN", 1.0)
    monkeypatch.setattr(settings, "PRICE_MAIN_OUT", 2.0)
    monkeypatch.setattr(settings, "PRICE_LITE_IN", 0.1)
    monkeypatch.setattr(settings, "PRICE_LITE_OUT", 0.2)
    monkeypatch.setattr(settings, "PRICE_EMBED_IN", 0.5)
    meter = start_metering()
    record_usage(settings.TEXT_MODEL, FakeResponse(FakeUsage(1_000_000, 1_000_000)))
    record_usage(settings.LITE_MODEL, FakeResponse(FakeUsage(1_000_000, 1_000_000)))
    record_usage(settings.EMBED_MODEL, FakeResponse(FakeUsage(1_000_000)))  # embeddings: no output
    assert meter.cost_usd == pytest.approx(3.0 + 0.3 + 0.5)
    assert _tier_price(settings.VISION_MODEL, 1_000_000, 0) == pytest.approx(1.0)  # main tier


def test_record_usage_is_noop_without_metering():
    # No start_metering() in this context → record silently does nothing (never raises).
    record_usage(settings.TEXT_MODEL, FakeResponse(FakeUsage(10, 10)))


def test_record_usage_tolerates_missing_usage():
    meter = start_metering()
    record_usage(settings.TEXT_MODEL, FakeResponse(None))  # e.g. a mid-stream chunk
    # A response object without the attribute at all must also be safe.
    record_usage(settings.TEXT_MODEL, object())
    assert meter.calls == 0


def test_meter_accumulates_across_models():
    meter = start_metering()
    record_usage(settings.TEXT_MODEL, FakeResponse(FakeUsage(100, 50, cost=0.01)))
    record_usage(settings.TEXT_MODEL, FakeResponse(FakeUsage(20, 10, cost=0.02)))
    record_usage(settings.LITE_MODEL, FakeResponse(FakeUsage(5, 3, cost=0.0)))
    assert meter.by_model[settings.TEXT_MODEL] == [120, 60]
    assert meter.by_model[settings.LITE_MODEL] == [5, 3]
    assert meter.cost_usd == pytest.approx(0.03)
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
    meter.add(settings.TEXT_MODEL, 100, 200, 0.5)
    meter.add(settings.LITE_MODEL, 10, 5, 0.25)
    meter.add(settings.EMBED_MODEL, 7, 0, 0.0)
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
    assert users_doc["lifetime_tokens_in_embed"].value == 7
    assert users_doc["lifetime_ai_calls"].value == 2
    assert users_doc["lifetime_cost_usd"].value == pytest.approx(0.75)
    assert by_collection["system"]["tok_cost_usd"].value == pytest.approx(0.75)


async def test_flush_usage_noop_when_no_calls(monkeypatch):
    called = False

    def boom():
        nonlocal called
        called = True
        raise AssertionError("get_db must not be touched for an empty meter")

    monkeypatch.setattr(fb_mod, "get_db", boom)
    await fb_mod.flush_usage("u123", UsageMeter())  # calls == 0
    assert called is False
