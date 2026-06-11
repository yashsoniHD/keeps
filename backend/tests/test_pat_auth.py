"""PAT verification: bcrypt check, brute-force lockout, counter reset on success."""
import bcrypt
import pytest
from fastapi import HTTPException

import services.auth_dep as auth_dep

SECRET = "test-secret-value"
# rounds=4 = bcrypt's minimum; production uses the default 12 — irrelevant to logic.
HASH = bcrypt.hashpw(SECRET.encode(), bcrypt.gensalt(rounds=4)).decode()


def seed_token(fake_db, failed_attempts=0):
    fake_db.seed("shortcut_tokens", "tok123", {
        "user_id": "uid-1",
        "token_hash": HASH,
        "failed_attempts": failed_attempts,
    })


@pytest.fixture(autouse=True)
def patch_db(fake_db, monkeypatch):
    monkeypatch.setattr(auth_dep, "get_db", lambda: fake_db)


async def test_valid_token_returns_uid(fake_db):
    seed_token(fake_db)
    assert await auth_dep._verify_pat(f"cn_tok123.{SECRET}") == "uid-1"
    # last_used_at bumped; failed_attempts untouched (was already 0 → no extra write)
    assert "last_used_at" in fake_db.docs[("shortcut_tokens", "tok123")]


async def test_malformed_token_rejected():
    with pytest.raises(HTTPException) as e:
        await auth_dep._verify_pat("cn_nodotseparator")
    assert e.value.status_code == 401


async def test_unknown_token_id_rejected(fake_db):
    with pytest.raises(HTTPException) as e:
        await auth_dep._verify_pat(f"cn_missing.{SECRET}")
    assert e.value.status_code == 401


async def test_wrong_secret_increments_failed_attempts(fake_db):
    seed_token(fake_db)
    with pytest.raises(HTTPException):
        await auth_dep._verify_pat("cn_tok123.wrong-secret")
    assert fake_db.docs[("shortcut_tokens", "tok123")]["failed_attempts"] == 1


async def test_locked_token_rejected_even_with_correct_secret(fake_db):
    seed_token(fake_db, failed_attempts=auth_dep.MAX_FAILED_PAT_ATTEMPTS)
    with pytest.raises(HTTPException) as e:
        await auth_dep._verify_pat(f"cn_tok123.{SECRET}")
    assert e.value.status_code == 401
    # Lock check fires before the bcrypt compare: no update of any kind happened.
    assert fake_db.updates == []


async def test_success_resets_failed_attempts(fake_db):
    seed_token(fake_db, failed_attempts=3)
    assert await auth_dep._verify_pat(f"cn_tok123.{SECRET}") == "uid-1"
    assert fake_db.docs[("shortcut_tokens", "tok123")]["failed_attempts"] == 0
