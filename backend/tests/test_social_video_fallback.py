"""social_video.acquire caption fallback: when yt-dlp can't download the media (Instagram's
"login required / rate-limit reached" wall, routine from datacenter IPs without cookies),
acquire must NOT raise — it builds a note from the post's public og: tags (og:description is
the caption) instead of letting the resolver drop through to the generic login-wall scraper.
"""
import pytest

import services.sources.social_video as sv

_OG_HTML = """
<html><head>
<meta property="og:title" content="traveler on Instagram">
<meta property="og:description" content="2,431 likes - traveler: Best 3 cafes in Lisbon you must try — start with Fabrica ☕">
<meta property="og:image" content="https://scontent.cdninstagram.com/poster.jpg">
</head><body>Log in to Instagram</body></html>
"""


class _FakeResp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


class _FakeClient:
    """Stands in for guarded_async_client's async context manager."""
    def __init__(self, text_or_exc):
        self._t = text_or_exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        if isinstance(self._t, Exception):
            raise self._t
        return _FakeResp(self._t)


def _raise_download_block(url):
    # yt-dlp raises DownloadError rather than returning None — that's the case the old code
    # let escape to the generic scraper. Any Exception models it here.
    raise RuntimeError("ERROR: [Instagram] X: Requested content is not available, "
                       "rate-limit reached or login required.")


async def test_blocked_download_uses_caption_from_og_tags(monkeypatch):
    monkeypatch.setattr(sv, "_download", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(_OG_HTML))

    bundle = await sv.acquire("https://www.instagram.com/p/DY6zt0_DE3v/")

    assert bundle.strategy == "social_og"
    assert bundle.kind == "text"
    assert "Best 3 cafes in Lisbon" in bundle.text  # the real caption, not the login wall
    assert bundle.images == ["https://scontent.cdninstagram.com/poster.jpg"]
    assert bundle.metadata["platform"] == "instagram"
    assert "Best 3 cafes" in bundle.metadata["caption"]


async def test_blocked_download_does_not_raise_when_og_fetch_also_fails(monkeypatch):
    """Even if the og: fetch fails, acquire returns a URL-only bundle so the pipeline can
    salvage a bookmark — it must never re-raise the download error."""
    monkeypatch.setattr(sv, "_download", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client",
                        lambda **kw: _FakeClient(RuntimeError("blocked")))

    url = "https://www.instagram.com/reel/ZZZ/"
    bundle = await sv.acquire(url)

    assert bundle.strategy == "social_og"
    assert bundle.text == url
    assert bundle.images == []


async def test_apify_disabled_skips_straight_to_og(monkeypatch):
    """With no APIFY_TOKEN, the paid path must short-circuit before reserving a slot (no
    Firestore touch, no cost) and fall to the og-caption fallback."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "")
    monkeypatch.setattr(sv, "_download", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(_OG_HTML))

    bundle = await sv.acquire("https://www.instagram.com/reel/ZZZ/")
    assert bundle.strategy == "social_og"


async def test_apify_video_path_when_ytdlp_blocked(monkeypatch):
    """yt-dlp blocked + APIFY_TOKEN set → Apify returns a video URL, we fetch it and route
    it through the GCS video path (strategy apify_gcs) for full Gemini video analysis."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "tok")
    monkeypatch.setattr(sv.settings, "CLOUD_STORAGE_BUCKET", "bucket")
    monkeypatch.setattr(sv, "_download", _raise_download_block)

    async def fake_reserve():
        return True

    async def fake_fetch(url):
        return {"video_url": "https://scontent.cdninstagram.com/v.mp4",
                "caption": "Best 3 cafes in Lisbon", "title": "Best 3 cafes in Lisbon",
                "thumbnail": "https://scontent.cdninstagram.com/t.jpg",
                "author": "traveler", "duration": 16}

    async def fake_dl_media(media_url):
        assert media_url == "https://scontent.cdninstagram.com/v.mp4"
        return "/tmp/apify_x.mp4"

    async def fake_frame(path):
        return "https://storage.googleapis.com/covers/abc.jpg"

    monkeypatch.setattr("services.firebase.reserve_apify_slot", fake_reserve)
    monkeypatch.setattr("services.apify.fetch", fake_fetch)
    monkeypatch.setattr(sv, "_download_media", fake_dl_media)
    monkeypatch.setattr(sv, "_upload_to_gcs", lambda p: "gs://bucket/media/x.mp4")
    monkeypatch.setattr("services.covers.extract_video_frame", fake_frame)
    monkeypatch.setattr(sv.os.path, "exists", lambda p: False)  # skip temp-file cleanup

    bundle = await sv.acquire("https://www.instagram.com/reel/ZZZ/")
    assert bundle.strategy == "apify_gcs"
    assert bundle.video_uri == "gs://bucket/media/x.mp4"
    assert bundle.images == ["https://storage.googleapis.com/covers/abc.jpg"]
    assert bundle.metadata["caption"] == "Best 3 cafes in Lisbon"


async def test_apify_cap_reached_falls_through_to_og(monkeypatch):
    """When the global daily Apify cap is hit, reserve returns False → no scrape, og-caption."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "tok")
    monkeypatch.setattr(sv, "_download", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(_OG_HTML))

    async def fake_reserve():
        return False

    def _no_fetch(url):
        raise AssertionError("apify.fetch must not be called once the cap is hit")

    monkeypatch.setattr("services.firebase.reserve_apify_slot", fake_reserve)
    monkeypatch.setattr("services.apify.fetch", _no_fetch)

    bundle = await sv.acquire("https://www.instagram.com/reel/ZZZ/")
    assert bundle.strategy == "social_og"
    assert "Best 3 cafes in Lisbon" in bundle.text
