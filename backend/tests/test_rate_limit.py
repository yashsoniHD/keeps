"""Per-IP flood guard: throttles the expensive POST endpoints, leaves reads alone."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.rate_limit import RateLimitMiddleware


def _make_app(limit: int) -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, limit_per_min=limit)

    @app.post("/api/ingest")
    def ingest():
        return {"ok": True}

    @app.post("/api/ask")
    def ask():
        return {"ok": True}

    @app.get("/api/notes")
    def notes():
        return {"ok": True}

    return app


def test_blocks_posts_past_the_limit():
    client = TestClient(_make_app(limit=3))
    for _ in range(3):
        assert client.post("/api/ingest").status_code == 200
    r = client.post("/api/ingest")
    assert r.status_code == 429
    assert "slow down" in r.json()["detail"].lower()


def test_limit_is_shared_across_throttled_paths():
    client = TestClient(_make_app(limit=2))
    assert client.post("/api/ingest").status_code == 200
    assert client.post("/api/ask").status_code == 200
    assert client.post("/api/ingest").status_code == 429  # same IP, shared window


def test_reads_are_never_throttled():
    client = TestClient(_make_app(limit=1))
    client.post("/api/ingest")  # consume the only token
    for _ in range(5):
        assert client.get("/api/notes").status_code == 200
