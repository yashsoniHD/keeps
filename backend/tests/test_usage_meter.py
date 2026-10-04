"""AI usage metering: OpenRouter cost accounting, model-that-answered counts, contextvar
isolation, and the global-daily-only flush."""
import pytest

import services.firebase as fb_mod
from config import settings
from services.usage_meter import UsageMeter, fallback_price, record_usage, start_metering


class FakeUsage:
    def __init__(self, prompt, completion=0, cost=None):
        self.prompt_tokens = prompt
        self.completion_tokens = completion
        if cost is not None:
            self.cost = cost


class FakeResponse:
    def __init__(self, usage):
        self.usage = usage


def test_record_usage_reads_billed_cost_and_counts_model():
    meter = start_metering()
    record_usage("deepseek/deepseek-v3.2", FakeResponse(FakeUsage(100, 40, cost=0.0123)))
    assert meter.models == {"deepseek/deepseek-v3.2": 1}
    assert meter.cost_usd == pytest.approx(0.0123)
    assert meter.calls == 1 and meter.last_model == "deepseek/deepseek-v3.2"


def test_fallback_price_without_cost(monkeypatch):
    monkeypatch.setattr(settings, "PRICE_MAIN_IN", 1.0)
    monkeypatch.setattr(settings, "PRICE_MAIN_OUT", 2.0)
    monkeypatch.setattr(settings, "PRICE_EMBED_IN", 0.5)
    meter = start_metering()
    record_usage("paid/model", FakeResponse(FakeUsage(1_000_000, 1_000_000)))      # 3.0
    record_usage(settings.EMBED_MODEL, FakeResponse(FakeUsage(1_000_000)))        # 0.5
    record_usage("nvidia/x:free", FakeResponse(FakeUsage(1_000_000, 1_000_000)))  # 0.0
    assert meter.cost_usd == pytest.approx(3.5)
    assert fallback_price("nvidia/x:free", 10**9, 10**9) == 0.0
    assert meter.calls == 3


def test_record_usage_is_noop_without_metering():
    record_usage("m", FakeResponse(FakeUsage(10, 10)))  # never raises


def test_record_usage_tolerates_missing_usage():
    meter = start_metering()
    record_usage("m", FakeResponse(None))
    record_usage("m", object())
    assert meter.calls == 0 and meter.models == {}


def test_meter_accumulates_across_calls():
    meter = start_metering()
    record_usage("a", FakeResponse(FakeUsage(100, 50, cost=0.01)))
    record_usage("a", FakeResponse(FakeUsage(20, 10, cost=0.02)))
    record_usage("b:free", FakeResponse(FakeUsage(5, 3, cost=0.0)))
    assert meter.models == {"a": 2, "b:free": 1}
    assert meter.cost_usd == pytest.approx(0.03)
    assert meter.calls == 3 and meter.last_model == "b:free"


async def test_flush_usage_writes_only_global_daily(monkeypatch):
    writes: list[tuple[tuple[str, str], dict]] = []

    class FakeRef:
        def __init__(self, key):
            self._key = key

        async def set(self, data, merge=False):
            writes.append((self._key, data))

    class FakeDb:
        def collection(self, name):
            return type("C", (), {"document": lambda _s, d: FakeRef((name, d))})()

    monkeypatch.setattr(fb_mod, "get_db", lambda: FakeDb())
    meter = UsageMeter()
    meter.add("a", 0.5)
    meter.add("b", 0.25)
    await fb_mod.flush_usage("u123", meter)

    assert [k[0] for k, _ in writes] == ["system"]  # no per-user lifetime counters
    data = writes[0][1]
    assert data["tok_ai_calls"].value == 2
    assert data["tok_cost_usd"].value == pytest.approx(0.75)


async def test_flush_usage_noop_when_no_calls(monkeypatch):
    def boom():
        raise AssertionError("get_db must not be touched for an empty meter")

    monkeypatch.setattr(fb_mod, "get_db", boom)
    await fb_mod.flush_usage("u123", UsageMeter())


async def test_flush_usage_increments_sanitized_model_counters(monkeypatch):
    writes = []

    class FakeRef:
        async def set(self, data, merge=False):
            writes.append((data, merge))

    class FakeDb:
        def collection(self, name):
            return type("C", (), {"document": lambda _s, d: FakeRef()})()

    monkeypatch.setattr(fb_mod, "get_db", lambda: FakeDb())
    meter = UsageMeter()
    meter.add("nvidia/nemotron-3-super-120b-a12b:free", 0.0)
    meter.add("deepseek/deepseek-v3.2", 0.01)
    meter.add("deepseek/deepseek-v3.2", 0.01)
    await fb_mod.flush_usage("u1", meter)

    data, merge = writes[0]
    assert merge is True
    models = {k: v.value for k, v in data["models"].items()}
    assert models == {"nvidia_nemotron-3-super-120b-a12b:free": 1, "deepseek_deepseek-v3_2": 2}
