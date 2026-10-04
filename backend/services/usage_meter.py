"""Request-scoped AI usage meter (calls + USD + which model answered).

Keeps `gemini.py` free of any Firestore dependency: each model call records its OpenAI-shape
`usage` into a contextvar-held meter, and the route flushes the accumulated totals to Firestore
exactly once at the end of the request.

Why a contextvar holding a *mutable* object: `asyncio.to_thread` copies the current
context into the worker thread (`contextvars.copy_context()`), so the synchronous
model calls that run off the event loop share the SAME meter object as the async
handler that started metering — appends made in the thread are visible to the handler
when `to_thread` returns. A new task (each request) gets its own copy, so meters never
leak across requests.
"""
import contextvars
import logging

from config import settings

log = logging.getLogger("clipnote.usage")

_meter: contextvars.ContextVar["UsageMeter | None"] = contextvars.ContextVar(
    "gemini_usage_meter", default=None
)


class UsageMeter:
    """Per-request totals that `firebase.flush_usage` adds to the global daily counter
    (system/usage-{date}: tok_ai_calls, tok_cost_usd). `models` counts calls per model that
    actually answered (OpenRouter's `response.model` — the free or the paid fallback)."""
    __slots__ = ("models", "calls", "cost_usd", "last_model")

    def __init__(self) -> None:
        self.models: dict[str, int] = {}
        self.calls = 0
        self.cost_usd = 0.0
        self.last_model = ""

    def add(self, model: str, cost_usd: float = 0.0) -> None:
        self.models[model] = self.models.get(model, 0) + 1
        self.cost_usd += cost_usd
        self.calls += 1
        self.last_model = model


def start_metering() -> UsageMeter:
    """Begin a fresh meter for this request. Returns it so the handler can flush."""
    meter = UsageMeter()
    _meter.set(meter)
    return meter


def fallback_price(model: str, tokens_in: int, tokens_out: int) -> float:
    """USD from the config price table (per 1M tokens) when OpenRouter reports no cost."""
    if model.endswith(":free"):
        return 0.0
    if model == settings.EMBED_MODEL:
        return tokens_in * settings.PRICE_EMBED_IN / 1_000_000
    return (tokens_in * settings.PRICE_MAIN_IN + tokens_out * settings.PRICE_MAIN_OUT) / 1_000_000


def record_usage(model: str, response) -> None:
    """Record one OpenRouter response into the active meter (no-op if none or no `usage`).

    `model` should be the model that actually answered (`response.model`). Cost is
    OpenRouter's billed `usage.cost` when present, else `fallback_price`.
    """
    meter = _meter.get()
    if meter is None:
        return
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    cost = getattr(usage, "cost", None)
    if not isinstance(cost, (int, float)):
        cost = fallback_price(model, getattr(usage, "prompt_tokens", 0) or 0,
                              getattr(usage, "completion_tokens", 0) or 0)
    meter.add(model, float(cost))
