"""Per-IP flood guard for the expensive POST endpoints.

This is *abuse/flood* protection layered in front of the authoritative, transactional cost
caps (per-user + global, enforced in the routers). It stops a single client from hammering
ingest/ask — wasting their quota, spamming 429s, or stampeding the Cloud Tasks worker.

It is in-memory and therefore PER Cloud Run INSTANCE, not a global quota. That's deliberate:
the cost ceiling is already guaranteed by the Firestore counters; this just smooths bursts.
For a hard global throttle, front the service with Cloud Armor.
"""
import logging
import time
from collections import deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

log = logging.getLogger("clipnote.ratelimit")

# Only the costly endpoints are throttled. Other reads, the OIDC worker (/api/process*), and
# the client-error sink are exempt. str.startswith accepts a tuple of prefixes.
# /api/search is a GET but embeds every query (a paid Vertex call), so it's throttled too.
_THROTTLED_PREFIXES = ("/api/ingest", "/api/ask")
_THROTTLED_GET_PREFIXES = ("/api/search",)


def _client_ip(request) -> str:
    # Cloud Run puts the real client IP first in X-Forwarded-For.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, limit_per_min: int):
        super().__init__(app)
        self._limit = limit_per_min
        self._hits: dict[str, deque] = {}

    async def dispatch(self, request, call_next):
        path = request.url.path
        if request.method == "POST" and path.startswith(_THROTTLED_PREFIXES):
            bucket_kind = "write"
        elif request.method == "GET" and path.startswith(_THROTTLED_GET_PREFIXES):
            bucket_kind = "search"
        else:
            return await call_next(request)

        now = time.monotonic()
        window_start = now - 60.0
        # Separate buckets per path class: a burst of (debounced, per-keystroke) searches must
        # never starve a capture save from the same IP within the window.
        ip = f"{_client_ip(request)}:{bucket_kind}"
        dq = self._hits.setdefault(ip, deque())
        while dq and dq[0] < window_start:
            dq.popleft()
        if len(dq) >= self._limit:
            log.warning("rate limit hit", extra={"client_ip": ip, "path": path})
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down and try again."},
            )
        dq.append(now)

        # Opportunistic prune so idle IPs don't accumulate unbounded.
        if len(self._hits) > 10_000:
            for k in [k for k, v in self._hits.items() if not v or v[-1] < window_start]:
                self._hits.pop(k, None)

        return await call_next(request)
