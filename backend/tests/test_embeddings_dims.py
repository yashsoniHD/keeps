"""EmbeddingService dimension handling: pass through, Matryoshka-truncate, fail on short."""
import math
from types import SimpleNamespace

import pytest

import services.embeddings as emb
from config import settings


def _svc(vec, monkeypatch):
    svc = emb.EmbeddingService()
    resp = SimpleNamespace(data=[SimpleNamespace(embedding=vec)])
    svc.client = SimpleNamespace(embeddings=SimpleNamespace(create=lambda **kw: resp))
    monkeypatch.setattr(emb, "record_usage", lambda *a, **k: None)
    return svc


async def test_exact_dim_passthrough(monkeypatch):
    vec = [0.5] * settings.EMBED_DIM
    assert await _svc(vec, monkeypatch).embed_document("x") == vec


async def test_oversized_truncated_and_normalized(monkeypatch):
    # Fixed non-zero vector, always longer than EMBED_DIM; reset the log-once flag so no
    # earlier test's state matters.
    monkeypatch.setattr(emb, "_warned_trunc", False)
    monkeypatch.setattr(settings, "EMBED_DIM", 768)
    vec = [float(i % 7 + 1) for i in range(4096)]
    out = await _svc(vec, monkeypatch).embed_document("x")
    assert len(out) == settings.EMBED_DIM
    assert math.sqrt(sum(x * x for x in out)) == pytest.approx(1.0, abs=1e-6)


async def test_short_vector_raises(monkeypatch):
    with pytest.raises(ValueError):
        await _svc([0.1] * 512, monkeypatch).embed_document("x")
