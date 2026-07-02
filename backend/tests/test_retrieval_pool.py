"""candidate_pool embedding economics: one ask = ONE paid query embedding, threaded
through both the notes shortlist and the mini-app items shortlist."""
import services.note_retrieval as nr
from services.embeddings import embedding_service


async def test_candidate_pool_embeds_the_query_once(fake_db, monkeypatch):
    calls = []

    async def counting_embed(text):
        calls.append(text)
        return [0.0] * 8

    monkeypatch.setattr(embedding_service, "embed_query", counting_embed)
    await nr.candidate_pool(fake_db, "u", "what should I cook tonight")
    assert calls == ["what should I cook tonight"]


async def test_shortlists_still_embed_when_called_standalone(fake_db, monkeypatch):
    """Direct callers that don't pre-embed (agent tools) keep working."""
    calls = []

    async def counting_embed(text):
        calls.append(text)
        return [0.0] * 8

    monkeypatch.setattr(embedding_service, "embed_query", counting_embed)
    assert await nr.vector_shortlist(fake_db, "u", "q1") == []
    assert await nr.item_shortlist(fake_db, "u", "q2") == []
    assert calls == ["q1", "q2"]


async def test_embed_failure_degrades_to_recency_only(fake_db, monkeypatch):
    async def broken_embed(text):
        raise RuntimeError("vertex down")

    monkeypatch.setattr(embedding_service, "embed_query", broken_embed)
    fake_db.seed("notes", "n1", {"user_id": "u", "title": "T", "created_at": 1})
    pool = await nr.candidate_pool(fake_db, "u", "anything")
    assert [n["id"] for n in pool] == ["n1"]  # recency coverage survives the embed miss
