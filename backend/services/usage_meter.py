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
    __slots__ = ("by_model", "audio_in_by_model", "calls")

    def __init__(self) -> None:
        # model id -> [tokens_in, tokens_out]. Kept as a 2-element list because
        # firebase._split_by_tier unpacks it as `(tin, tout)`.
        self.by_model: dict[str, list[int]] = {}
        # model id -> audio-modality input tokens. A SUBSET of by_model[model][0] (input),
        # tracked separately so cost can price it at the higher audio rate. Empty until a
        # caller passes modality="audio" to record_usage.
        self.audio_in_by_model: dict[str, int] = {}
        self.calls = 0

    def add(self, model: str, tokens_in: int, tokens_out: int, audio_in: int = 0) -> None:
        slot = self.by_model.setdefault(model, [0, 0])
        slot[0] += tokens_in
        slot[1] += tokens_out
        if audio_in:
            self.audio_in_by_model[model] = self.audio_in_by_model.get(model, 0) + audio_in
        self.calls += 1

    def audio_input_tokens(self) -> int:
        """Total audio-modality input tokens recorded (a subset of the input totals in
        by_model). Exposed so a persister can split the audio subtotal out of main-tier
        input and price it at the higher audio rate."""
        return sum(self.audio_in_by_model.values())


def start_metering() -> UsageMeter:
    """Begin a fresh meter for this request. Returns it so the handler can flush."""
    meter = UsageMeter()
    _meter.set(meter)
    return meter


def record_usage(model: str, response, modality: str = "text") -> None:
    """Record one Gemini response's token usage into the active meter (no-op if none).

    Output tokens include thinking tokens (`thoughts_token_count`): Gemini 3.x bills
    them, and they are NOT included in `candidates_token_count`. Omitting them
    under-counts cost on exactly the thinking-heavy extraction calls.

    `modality` hints what the INPUT tokens were: "text" (default) or "audio". Audio input
    bills higher (~2× text), so when "audio" the input tokens are also recorded as an
    audio subtotal (see UsageMeter.audio_in_by_model) that cost can price at the audio rate.
    DEFERRED: gemini.py's voice call sites don't pass modality yet, so audio still meters at
    the text rate today — this param is the ready hook to finish that wiring.
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
    audio_in = tokens_in if modality == "audio" else 0
    meter.add(model, tokens_in, tokens_out, audio_in)
