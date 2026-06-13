"""firebase.reserve_image_slot: transactional per-user + global daily cap on AI cover
generation. Returns True (claim, increment) when under both caps, False when either is
hit — and never raises, because a capped note must still be created."""
from datetime import datetime, timezone

import pytest

import services.firebase as fb

TODAY = datetime.now(timezone.utc).strftime("%Y%m%d")


class FakeTransaction:
    def __init__(self, db):
        self._db = db

    def set(self, ref, data, merge=False):
        base = self._db.docs.get(ref._key, {}) if merge else {}
        self._db.docs[ref._key] = {**base, **data}


@pytest.fixture(autouse=True)
def patch_fb(fake_db, monkeypatch):
    fake_db.transaction = lambda: FakeTransaction(fake_db)
    monkeypatch.setattr(fb, "get_db", lambda: fake_db)
    # The real decorator needs a real Transaction; run the inner coroutine directly.
    monkeypatch.setattr("google.cloud.firestore.async_transactional", lambda f: f)
    monkeypatch.setattr(fb.settings, "MAX_IMAGES_PER_USER_PER_DAY", 3)
    monkeypatch.setattr(fb.settings, "DAILY_GLOBAL_IMAGE_CAP", 5)
    return fake_db


async def test_claims_when_under_caps(patch_fb):
    assert await fb.reserve_image_slot("u1") is True
    assert patch_fb.docs[("usage", f"u1-{TODAY}")]["image_count"] == 1
    assert patch_fb.docs[("system", f"usage-{TODAY}")]["image_count"] == 1


async def test_per_user_cap_blocks(patch_fb):
    patch_fb.seed("usage", f"u1-{TODAY}", {"image_count": 3})  # at MAX_IMAGES_PER_USER_PER_DAY
    assert await fb.reserve_image_slot("u1") is False
    # global counter must not have moved
    assert ("system", f"usage-{TODAY}") not in patch_fb.docs


async def test_global_cap_blocks(patch_fb):
    patch_fb.seed("system", f"usage-{TODAY}", {"image_count": 5})  # at DAILY_GLOBAL_IMAGE_CAP
    assert await fb.reserve_image_slot("u2") is False


async def test_never_raises(patch_fb, monkeypatch):
    def boom():
        raise RuntimeError("firestore down")

    patch_fb.transaction = boom
    assert await fb.reserve_image_slot("u3") is False
