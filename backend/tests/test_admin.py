"""Admin dashboard: email-gated access + stats aggregation/cost rollup."""
import pytest
from fastapi import HTTPException

import routers.admin as admin_mod
from config import settings


@pytest.fixture(autouse=True)
def _admin_allowlist(monkeypatch):
    """ADMIN_EMAILS has no baked-in default (unset ⇒ admin closed) — give tests one."""
    monkeypatch.setattr(settings, "ADMIN_EMAILS", {"admin@test.dev"})


# ---------------- require_admin gating ----------------

async def test_no_header_is_401():
    with pytest.raises(HTTPException) as e:
        await admin_mod.require_admin(None)
    assert e.value.status_code == 401


async def test_pat_is_rejected():
    with pytest.raises(HTTPException) as e:
        await admin_mod.require_admin("Bearer cn_abc.def")
    assert e.value.status_code == 403


async def test_non_admin_email_is_403(monkeypatch):
    async def claims(_token):
        return {"uid": "u1", "email": "stranger@example.com", "email_verified": True}

    monkeypatch.setattr(admin_mod, "verify_firebase_token_claims", claims)
    with pytest.raises(HTTPException) as e:
        await admin_mod.require_admin("Bearer goodjwt")
    assert e.value.status_code == 403


async def test_unverified_admin_email_is_403(monkeypatch):
    admin_email = next(iter(settings.ADMIN_EMAILS))

    async def claims(_token):
        return {"uid": "u1", "email": admin_email, "email_verified": False}

    monkeypatch.setattr(admin_mod, "verify_firebase_token_claims", claims)
    with pytest.raises(HTTPException) as e:
        await admin_mod.require_admin("Bearer goodjwt")
    assert e.value.status_code == 403


async def test_verified_admin_email_passes(monkeypatch):
    admin_email = next(iter(settings.ADMIN_EMAILS))

    async def claims(_token):
        return {"uid": "admin-uid", "email": admin_email.upper(), "email_verified": True}

    monkeypatch.setattr(admin_mod, "verify_firebase_token_claims", claims)
    assert await admin_mod.require_admin("Bearer goodjwt") == "admin-uid"


# ---------------- cost math ----------------

def test_cost_usd_uses_frozen_legacy_prices(monkeypatch):
    # New DeepSeek PRICE_* must not affect historic Gemini tokens.
    monkeypatch.setattr(settings, "PRICE_MAIN_IN", 99.0)
    cost = admin_mod._cost_usd(1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000)
    assert cost == pytest.approx(1.50 + 9.00 + 0.25 + 1.50 + 0.025)


# ---------------- stats aggregation ----------------

class FakeAggResult:
    def __init__(self, value):
        self._value = value

    def __getitem__(self, i):
        # mirrors firestore: result[0][0].value
        return [type("V", (), {"value": self._value})()]


class FakeAgg:
    def __init__(self, value):
        self._value = value

    async def get(self):
        return FakeAggResult(self._value)


class FakeSnap:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


class FakeDocRef:
    def __init__(self, data):
        self._data = data

    async def get(self):
        return FakeSnap(self._data)


class FakeQuery:
    """Supports .where(...).stream(), .count(), and chaining."""

    def __init__(self, docs, counts):
        self._docs = docs
        self._counts = counts

    def where(self, field, op, value):
        if field == "user_id":
            filtered = [d for d in self._docs if d.get("user_id") == value]
            return FakeQuery(filtered, {"__count__": len(filtered)})
        if field == "status":
            filtered = [d for d in self._docs if d.get("status") == value]
            return FakeQuery(filtered, {"__count__": len(filtered)})
        if field == "date":  # >= cutoff
            filtered = [d for d in self._docs if d.get("date", "") >= value]
            return FakeQuery(filtered, {"__count__": len(filtered)})
        return self

    def count(self):
        return FakeAgg(self._counts.get("__count__", len(self._docs)))

    async def stream(self):
        for d in self._docs:
            yield FakeStreamDoc(d)


class FakeStreamDoc:
    def __init__(self, data):
        self.id = data.get("__id__", "doc")
        self._data = data

    def to_dict(self):
        return {k: v for k, v in self._data.items() if k != "__id__"}


class FakeDb:
    def __init__(self, collections, sys_doc):
        self._collections = collections
        self._sys_doc = sys_doc

    def collection(self, name):
        docs = self._collections.get(name, [])
        return FakeQuery(docs, {"__count__": len(docs)})

    # only system uses .document().get()
    def __getattr__(self, _):
        raise AttributeError


async def test_admin_stats_rolls_up_cost_and_activity(monkeypatch):
    monkeypatch.setattr(settings, "PRICE_MAIN_IN", 1.0)
    monkeypatch.setattr(settings, "PRICE_MAIN_OUT", 1.0)
    monkeypatch.setattr(settings, "PRICE_LITE_IN", 1.0)
    monkeypatch.setattr(settings, "PRICE_LITE_OUT", 1.0)
    monkeypatch.setattr(settings, "USD_TO_INR", 80.0)

    async def fake_list_auth_users():
        return [
            {"uid": "u1", "email": "a@x.com", "display_name": "Alice",
             "created_at": 1700000000000, "last_sign_in": 1700000001000},
            {"uid": "u2", "email": "b@x.com", "display_name": "Bob",
             "created_at": 1700000000000, "last_sign_in": None},
        ]

    monkeypatch.setattr(admin_mod, "list_auth_users", fake_list_auth_users)

    # u1 has 1M total tokens (all priced at $1/1M each = $1 total); u2 has none.
    users = [
        {"__id__": "u1", "lifetime_tokens_in_main": 250_000, "lifetime_tokens_out_main": 250_000,
         "lifetime_tokens_in_lite": 250_000, "lifetime_tokens_out_lite": 250_000,
         "lifetime_ai_calls": 7},
        {"__id__": "u2"},
    ]
    notes = [{"user_id": "u1"}, {"user_id": "u1"}, {"user_id": "u2"}]
    jobs = [{"status": "completed"}, {"status": "failed"}, {"status": "completed"}]
    # u1 active in last 7d; u2 only in last 30d window.
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    d_recent = now.strftime("%Y%m%d")
    d_old = (now - timedelta(days=20)).strftime("%Y%m%d")
    usage = [
        {"user_id": "u1", "date": d_recent},
        {"user_id": "u2", "date": d_old},
    ]
    # Today's global rollup lives in the "system" collection (read via .where(date>=).stream()).
    system = [{"__id__": f"usage-{d_recent}", "date": d_recent, "note_count": 5, "ask_count": 2}]
    fake_db = FakeDb(
        {"users": users, "notes": notes, "jobs": jobs, "usage": usage, "system": system},
        sys_doc=None,
    )
    monkeypatch.setattr(admin_mod, "get_db", lambda: fake_db)

    out = await admin_mod.admin_stats(_="admin-uid")

    assert out["totals"]["users"] == 2
    assert out["totals"]["notes"] == 3
    assert out["totals"]["jobs"] == 3
    assert out["totals"]["jobs_failed"] == 1
    assert out["totals"]["active_7d"] == 1
    assert out["totals"]["active_30d"] == 2
    assert out["totals"]["notes_today"] == 5
    assert out["totals"]["asks_today"] == 2
    # Funding metrics: both users have notes → 100% activation; cost spread over 2 active users.
    assert out["totals"]["activated"] == 2
    assert out["totals"]["activation_rate"] == pytest.approx(1.0)
    assert out["totals"]["cost_per_active_user_usd"] == pytest.approx(1.5313, abs=0.001)
    # u1: 250k each tier at legacy rates = 0.25*(1.5+9+0.25+1.5) = $3.0625
    assert out["totals"]["cost_usd"] == pytest.approx(3.06, abs=0.01)
    assert out["totals"]["cost_inr"] == pytest.approx(3.06 * 80.0, abs=1.0)

    # sorted by cost desc → u1 first
    assert out["users"][0]["uid"] == "u1"
    assert out["users"][0]["notes"] == 2
    assert out["users"][0]["ai_calls"] == 7
    assert out["users"][0]["active_7d"] is True
    assert out["users"][1]["uid"] == "u2"
    assert out["users"][1]["active_7d"] is False
    assert out["users"][1]["active_30d"] is True


async def test_admin_stats_legacy_plus_billed_cost(monkeypatch):
    """Lifetime = legacy-rate tokens + billed lifetime_cost_usd; daily trend uses the cutover
    date: before → legacy formula, on/after → billed tok_cost_usd."""
    monkeypatch.setattr(settings, "PRICE_MAIN_IN", 99.0)  # must be ignored
    monkeypatch.setattr(admin_mod, "COST_CUTOVER_DATE", "2000-01-01")  # today is post-cutover

    async def fake_list_auth_users():
        return [{"uid": "u1", "email": "a@x.com", "created_at": 0, "last_sign_in": None},
                {"uid": "u2", "email": "b@x.com", "created_at": 0, "last_sign_in": None}]

    monkeypatch.setattr(admin_mod, "list_auth_users", fake_list_auth_users)
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    users = [
        {"__id__": "u1", "lifetime_tokens_in_main": 1_000_000, "lifetime_cost_usd": 0.25},
        {"__id__": "u2", "lifetime_tokens_in_main": 1_000_000},
    ]
    system = [{"__id__": f"usage-{today}", "date": today, "tok_tokens_in_main": 1_000_000,
               "tok_cost_usd": 0.1}]
    fake_db = FakeDb({"users": users, "notes": [], "jobs": [], "usage": [], "system": system},
                     sys_doc=None)
    monkeypatch.setattr(admin_mod, "get_db", lambda: fake_db)

    out = await admin_mod.admin_stats(_="admin-uid")
    by_uid = {u["uid"]: u for u in out["users"]}
    assert by_uid["u1"]["cost_usd"] == pytest.approx(1.75)
    assert by_uid["u2"]["cost_usd"] == pytest.approx(1.5)
    assert {d["date"]: d["cost_usd"] for d in out["daily_trend"]}[today] == pytest.approx(0.1)

    monkeypatch.setattr(admin_mod, "COST_CUTOVER_DATE", "2999-01-01")  # today is pre-cutover
    out = await admin_mod.admin_stats(_="admin-uid")
    assert {d["date"]: d["cost_usd"] for d in out["daily_trend"]}[today] == pytest.approx(1.5)
