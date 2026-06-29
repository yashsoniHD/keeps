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

# Only the costly POST endpoints are throttled. Reads, the OIDC worker (/api/process*), and
# the client-error sink are exempt. str.startswith accepts a tuple of prefixes.
_THROTTLED_PREFIXES = ("/api/ingest", "/api/ask")


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
        if request.method != "POST" or not path.startswith(_THROTTLED_PREFIXES):
            return await call_next(request)

        now = time.monotonic()
        window_start = now - 60.0
        ip = _client_ip(request)
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
