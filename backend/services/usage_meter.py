"""Request-scoped AI usage meter (tokens + USD).

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
    __slots__ = ("by_model", "calls", "cost_usd")

    def __init__(self) -> None:
        # model id -> [tokens_in, tokens_out]. Kept as a 2-element list because
        # firebase._split_by_tier unpacks it as `(tin, tout)`.
        self.by_model: dict[str, list[int]] = {}
        self.calls = 0
        self.cost_usd = 0.0

    def add(self, model: str, tokens_in: int, tokens_out: int, cost_usd: float = 0.0) -> None:
        slot = self.by_model.setdefault(model, [0, 0])
        slot[0] += tokens_in
        slot[1] += tokens_out
        self.cost_usd += cost_usd
        self.calls += 1


def start_metering() -> UsageMeter:
    """Begin a fresh meter for this request. Returns it so the handler can flush."""
    meter = UsageMeter()
    _meter.set(meter)
    return meter


def _tier_price(model: str, tokens_in: int, tokens_out: int) -> float:
    """USD from the config fallback price table (per 1M tokens): lite, embed, else main."""
    if model == settings.LITE_MODEL:
        p_in, p_out = settings.PRICE_LITE_IN, settings.PRICE_LITE_OUT
    elif model == settings.EMBED_MODEL:
        p_in, p_out = settings.PRICE_EMBED_IN, 0.0
    else:
        p_in, p_out = settings.PRICE_MAIN_IN, settings.PRICE_MAIN_OUT
    return (tokens_in * p_in + tokens_out * p_out) / 1_000_000


def record_usage(model: str, response) -> None:
    """Record one OpenRouter response's usage into the active meter (no-op if none).

    Works for chat responses, the final streamed chunk (the only one carrying `usage`), and
    embeddings (`completion_tokens` absent → 0). `completion_tokens` already includes reasoning
    tokens. Cost is OpenRouter's billed `usage.cost` when present, else the config price table.
    """
    meter = _meter.get()
    if meter is None:
        return
    usage = getattr(response, "usage", None)
    if usage is None:
        return
    tokens_in = getattr(usage, "prompt_tokens", 0) or 0
    tokens_out = getattr(usage, "completion_tokens", 0) or 0
    cost = getattr(usage, "cost", None)
    if not isinstance(cost, (int, float)):
        cost = _tier_price(model, tokens_in, tokens_out)
    meter.add(model, tokens_in, tokens_out, float(cost))
