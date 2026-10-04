"""firestore.rules against the real emulator (REST, unsigned emulator JWTs). Skipped unless
FIRESTORE_EMULATOR_HOST is set — run with:
  firebase emulators:exec --only firestore --project demo-clipnote \
    "cd backend && .venv/bin/python -m pytest -q tests/test_adversarial_rules_emulator.py"
"""
import base64
import json
import os

import httpx
import pytest

HOST = os.getenv("FIRESTORE_EMULATOR_HOST")
pytestmark = pytest.mark.skipif(not HOST, reason="Firestore emulator not running")
PROJECT = os.getenv("GCLOUD_PROJECT", "demo-clipnote")
BASE = f"http://{HOST}/v1/projects/{PROJECT}/databases/(default)/documents"


def _tok(uid):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return enc({"alg": "none", "typ": "JWT"}) + "." + enc(
        {"sub": uid, "user_id": uid, "aud": PROJECT, "iss": f"https://securetoken.google.com/{PROJECT}",
         "iat": 1, "exp": 9999999999, "auth_time": 1, "firebase": {"sign_in_provider": "google.com"}}) + "."


def _req(method, path, uid=None, body=None):
    h = {"Authorization": "Bearer owner"} if uid == "ADMIN" else (
        {"Authorization": f"Bearer {_tok(uid)}"} if uid else {})
    return httpx.request(method, f"{BASE}/{path}", headers=h, json=body, timeout=10)


def _fields(d):
    return {"fields": {k: ({"stringValue": v} if isinstance(v, str) else {"booleanValue": v})
                       for k, v in d.items()}}


@pytest.fixture(scope="module", autouse=True)
def seed():
    for path, data in [("acq_cache/a", {"caption": "c"}), ("shortcut_tokens/t", {"user_id": "u1"}),
                       ("usage/u1-1", {"user_id": "u1"}), ("system/usage-1", {"date": "1"}),
                       ("tmdb_cache/k", {"x": "y"}), ("notes/n1", {"user_id": "u1", "is_public": True}),
                       ("jobs/j1", {"user_id": "u1"}), ("users/u1", {"plan": "free"})]:
        assert _req("PATCH", path, "ADMIN", _fields(data)).status_code == 200


@pytest.mark.parametrize("path", ["acq_cache/a", "shortcut_tokens/t", "usage/u1-1",
                                  "system/usage-1", "tmdb_cache/k"])
@pytest.mark.parametrize("uid", [None, "u1"])
def test_backend_only_collections_deny_read_and_write(path, uid):
    assert _req("GET", path, uid).status_code == 403
    assert _req("PATCH", path, uid, _fields({"x": "y"})).status_code == 403


@pytest.mark.parametrize("uid", [None, "u2"])
def test_public_flag_does_not_open_note_reads(uid):
    assert _req("GET", "notes/n1", uid).status_code == 403


def test_owner_reads_own_note_but_cannot_write_it():
    assert _req("GET", "notes/n1", "u1").status_code == 200
    assert _req("PATCH", "notes/n1", "u1", _fields({"user_id": "u1", "title": "x"})).status_code == 403


def test_jobs_owner_read_only():
    assert _req("GET", "jobs/j1", "u1").status_code == 200
    assert _req("GET", "jobs/j1", "u2").status_code == 403
    assert _req("PATCH", "jobs/j1", "u1", _fields({"user_id": "u1", "status": "completed"})).status_code == 403


def test_unlisted_collection_denied():
    assert _req("GET", "acq_cache_x/a", "u1").status_code in (403, 404)
    assert _req("PATCH", "conversations/c", "u1", _fields({"user_id": "u1"})).status_code == 403


def test_owner_cannot_self_upgrade_plan():
    """RISK (Phase 3): users/{uid} is fully owner-writable."""
    r = _req("PATCH", "users/u1?updateMask.fieldPaths=plan", "u1", _fields({"plan": "pro"}))
    assert r.status_code == 403, "client set users/{uid}.plan = 'pro'"
