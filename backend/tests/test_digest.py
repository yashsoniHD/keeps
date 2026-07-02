"""Weekly digest: HTML rendering, signed unsubscribe, and the batch send logic."""
from datetime import datetime, timedelta, timezone

import pytest

import routers.digest as digest_mod
from config import settings


@pytest.fixture(autouse=True)
def _unsub_secret(monkeypatch):
    """_unsub_secret fails loud when unconfigured — give tests a deterministic one."""
    monkeypatch.setattr(settings, "DIGEST_UNSUB_SECRET", "test-unsub-secret")


class FakeReq:
    headers = {"authorization": "Bearer x"}


def test_build_html_lists_notes_and_unsub_link():
    notes = [
        {"id": "n1", "title": "Lemon Salmon", "ai_summary": "20-min weeknight dinner.",
         "content_type": "recipe"},
        {"id": "n2", "title": "RAG in 2026", "ai_summary": "Chunking and retrieval.",
         "content_type": "software"},
    ]
    html = digest_mod.build_digest_html("Alice Smith", notes, "https://x/unsub")
    assert "Lemon Salmon" in html and "RAG in 2026" in html
    assert "Hi Alice," in html  # first name only
    assert "https://x/unsub" in html
    assert "/notes/n1" in html


def test_unsub_token_roundtrips_and_rejects_tampering():
    t = digest_mod._unsub_token("user-123")
    assert digest_mod._unsub_token("user-123") == t  # deterministic
    assert digest_mod._unsub_token("user-999") != t  # bound to the uid


@pytest.fixture(autouse=True)
def patch_digest(fake_db, monkeypatch):
    monkeypatch.setattr(digest_mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(digest_mod, "verify_oidc", lambda request: None)
    sent: list[tuple[str, str]] = []

    async def fake_send(to, subject, html):
        sent.append((to, subject))
        return True

    monkeypatch.setattr(digest_mod, "send_email", fake_send)
    return sent


async def test_run_digest_sends_only_to_opted_in_users_with_recent_notes(
    fake_db, patch_digest, monkeypatch
):
    now = datetime.now(timezone.utc)
    recent, old = now - timedelta(days=1), now - timedelta(days=30)

    async def fake_auth_users():
        return [
            {"uid": "u1", "email": "a@x.com", "display_name": "Alice"},  # opted-in, recent note
            {"uid": "u2", "email": "b@x.com", "display_name": "Bob"},    # opted OUT
            {"uid": "u3", "email": "c@x.com", "display_name": "Cara"},   # opted-in, only old note
            {"uid": "u4", "email": None, "display_name": "NoEmail"},     # no address
        ]

    monkeypatch.setattr(digest_mod, "list_auth_users", fake_auth_users)
    fake_db.seed("users", "u1", {"digest_opt_in": True})
    fake_db.seed("users", "u2", {"digest_opt_in": False})
    fake_db.seed("users", "u3", {})
    fake_db.seed("notes", "n1", {"user_id": "u1", "created_at": recent, "title": "Fresh"})
    fake_db.seed("notes", "n3", {"user_id": "u3", "created_at": old, "title": "Stale"})

    out = await digest_mod.run_digest(FakeReq())

    assert out["sent"] == 1
    assert [to for to, _ in patch_digest] == ["a@x.com"]
    # Recorded the send time so we don't double-send.
    assert ("users", "u1") in fake_db.docs and "last_digest_at" in fake_db.docs[("users", "u1")]


async def test_unsubscribe_flips_opt_in_with_valid_token(fake_db, patch_digest):
    token = digest_mod._unsub_token("u1")
    resp = await digest_mod.unsubscribe(u="u1", t=token)
    assert resp.status_code == 200
    assert fake_db.docs[("users", "u1")]["digest_opt_in"] is False


async def test_unsubscribe_rejects_bad_token(fake_db, patch_digest):
    resp = await digest_mod.unsubscribe(u="u1", t="wrong")
    assert resp.status_code == 400
    assert ("users", "u1") not in fake_db.docs  # nothing written
