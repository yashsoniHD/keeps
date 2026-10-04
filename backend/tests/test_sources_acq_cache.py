"""6 h acquisition cache + Apify cap accounting (only successful runs count)."""
import hashlib
from datetime import datetime, timedelta, timezone

import services.acq_cache as acq_cache
import services.apify as apify
import services.firebase as firebase

URL = "https://www.instagram.com/reel/ABC/"
KEY = hashlib.sha256(URL.encode()).hexdigest()


async def test_put_then_get_roundtrip_metadata_only(fake_db, monkeypatch):
    monkeypatch.setattr(acq_cache, "get_db", lambda: fake_db)
    await acq_cache.put(URL, {"caption": "c", "media_url": "https://m", "video_bytes": b"x",
                              "strategy": "reel_video", "thumbnail": None})
    doc = fake_db.docs[("acq_cache", KEY)]
    assert "video_bytes" not in doc and "thumbnail" not in doc
    assert doc["expires_at"] - doc["cached_at"] == timedelta(hours=6)
    got = await acq_cache.get(URL)
    assert got["caption"] == "c" and got["media_url"] == "https://m"


async def test_expired_entry_is_a_miss(fake_db, monkeypatch):
    monkeypatch.setattr(acq_cache, "get_db", lambda: fake_db)
    fake_db.seed("acq_cache", KEY, {"caption": "old", "cached_at":
                                    datetime.now(timezone.utc) - timedelta(hours=6, minutes=1)})
    assert await acq_cache.get(URL) is None


async def test_firestore_errors_are_misses(monkeypatch):
    def boom():
        raise RuntimeError("firestore down")
    monkeypatch.setattr(acq_cache, "get_db", boom)
    assert await acq_cache.get(URL) is None
    await acq_cache.put(URL, {"caption": "c"})  # must not raise


async def _apify_setup(fake_db, monkeypatch, result):
    monkeypatch.setattr(apify.settings, "APIFY_TOKEN", "t")
    monkeypatch.setattr(firebase, "get_db", lambda: fake_db)

    async def fetch(url):
        return result
    monkeypatch.setattr(apify, "fetch", fetch)
    return await apify.fetch_capped(URL)


def _count(fake_db):
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return fake_db.docs[("system", f"usage-{today}")]["apify_count"]


async def test_failed_apify_run_releases_its_slot(fake_db, monkeypatch):
    assert await _apify_setup(fake_db, monkeypatch, None) is None
    assert _count(fake_db) == 0


async def test_successful_apify_run_keeps_its_slot(fake_db, monkeypatch):
    assert await _apify_setup(fake_db, monkeypatch, {"caption": "c"}) == {"caption": "c"}
    assert _count(fake_db) == 1


async def test_cap_reached_skips_the_run(fake_db, monkeypatch):
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    fake_db.seed("system", f"usage-{today}", {"apify_count": apify.settings.APIFY_DAILY_GLOBAL_CAP})
    called = []

    async def fetch(url):
        called.append(url)
    monkeypatch.setattr(apify.settings, "APIFY_TOKEN", "t")
    monkeypatch.setattr(firebase, "get_db", lambda: fake_db)
    monkeypatch.setattr(apify, "fetch", fetch)
    assert await apify.fetch_capped(URL) is None and called == []
