"""Request-scoped Gemini token meter.

Keeps `gemini.py` free of any Firestore dependency: each `generate_content` call
records its `usage_metadata` into a contextvar-held meter, and the route flushes the
accumulated totals to Firestore exactly once at the end of the request.

Why a contextvar holding a *mutable* object: `asyncio.to_thread` copies the current
context into the worker thread (`contextvars.copy_context()`), so the synchronous
Gemini calls that run off the event loop share the SAME meter object as the async
handler that started metering — appends made in the thread are visible to the handler
when `to_thread` returns. A new task (each request) gets its own copy, so meters never
leak across requests.
"""
import contextvars
import logging

log = logging.getLogger("clipnote.usage")

_meter: contextvars.ContextVar["UsageMeter | None"] = contextvars.ContextVar(
    "gemini_usage_meter", default=None
)


class UsageMeter:
    __slots__ = ("by_model", "calls")

    def __init__(self) -> None:
        # model id -> [tokens_in, tokens_out]
        self.by_model: dict[str, list[int]] = {}
        self.calls = 0

    def add(self, model: str, tokens_in: int, tokens_out: int) -> None:
        slot = self.by_model.setdefault(model, [0, 0])
        slot[0] += tokens_in
        slot[1] += tokens_out
        self.calls += 1


def start_metering() -> UsageMeter:
    """Begin a fresh meter for this request. Returns it so the handler can flush."""
    meter = UsageMeter()
    _meter.set(meter)
    return meter


def record_usage(model: str, response) -> None:
    """Record one Gemini response's token usage into the active meter (no-op if none).

    Output tokens include thinking tokens (`thoughts_token_count`): Gemini 3.x bills
    them, and they are NOT included in `candidates_token_count`. Omitting them
    under-counts cost on exactly the thinking-heavy extraction calls.
    """
    meter = _meter.get()
    if meter is None:
        return
    um = getattr(response, "usage_metadata", None)
    if um is None:
        return
    tokens_in = getattr(um, "prompt_token_count", 0) or 0
    tokens_out = (getattr(um, "candidates_token_count", 0) or 0) + (
        getattr(um, "thoughts_token_count", 0) or 0
    )
    meter.add(model, tokens_in, tokens_out)
