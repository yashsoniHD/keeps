"""social_video.acquire caption fallback: when yt-dlp can't download the media (Instagram's
"login required / rate-limit reached" wall, routine from datacenter IPs without cookies),
acquire must NOT raise — it builds a note from the post's public og: tags (og:description is
the caption) instead of letting the resolver drop through to the generic login-wall scraper.
"""
import pytest

import services.sources.social_video as sv
from models.note import ContentBundle

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


async def _raise_download_block(url):
    """yt-dlp blocked: `_meta_ytdlp` swallows the DownloadError and returns {}."""
    return {}


async def test_blocked_download_uses_caption_from_og_tags(monkeypatch):
    monkeypatch.setattr(sv, "_meta_ytdlp", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(_OG_HTML))

    bundle = await sv.acquire("https://www.instagram.com/p/DY6zt0_DE3v/")

    assert bundle.strategy == "social_og"
    assert bundle.kind == "text"
    assert "Best 3 cafes in Lisbon" in bundle.text  # the real caption, not the login wall
    assert bundle.images == ["https://scontent.cdninstagram.com/poster.jpg"]
    assert bundle.metadata["platform"] == "instagram"
    assert "Best 3 cafes" in bundle.metadata["caption"]


async def test_blocked_download_does_not_raise_when_og_fetch_also_fails(monkeypatch):
    """Even if the og: fetch fails, acquire returns a bundle (never raises) — and never
    `text=url`, which would let the model hallucinate a note from the URL slug."""
    monkeypatch.setattr(sv, "_meta_ytdlp", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client",
                        lambda **kw: _FakeClient(RuntimeError("blocked")))

    url = "https://www.instagram.com/reel/ZZZ/"
    bundle = await sv.acquire(url)

    assert bundle.strategy == "private_or_blocked"
    assert bundle.kind == "metadata_only"
    assert bundle.text is None
    assert bundle.images == []


async def test_login_wall_title_is_private_or_blocked(monkeypatch):
    """A login wall serves only the generic site title — no caption, no image."""
    monkeypatch.setattr(sv, "_meta_ytdlp", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(
        '<html><head><meta property="og:title" content="Instagram"></head></html>'))
    bundle = await sv.acquire("https://www.instagram.com/p/XYZ/")
    assert bundle.strategy == "private_or_blocked"


async def test_apify_disabled_skips_straight_to_og(monkeypatch):
    """With no APIFY_TOKEN, the paid path must short-circuit before reserving a slot (no
    Firestore touch, no cost) and fall to the og-caption fallback."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "")
    monkeypatch.setattr(sv, "_meta_ytdlp", _raise_download_block)
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(_OG_HTML))

    bundle = await sv.acquire("https://www.instagram.com/reel/ZZZ/")
    assert bundle.strategy == "social_og"


def test_caption_cap_is_4000():
    """Listicle captions run long; the cap is 4000 (was 2000, which truncated later venues)."""
    assert sv._CAPTION_MAX == 4000
    meta = sv._metadata({"description": "x" * 5000, "title": "t"},
                        "https://www.instagram.com/p/x/")
    assert len(meta["caption"]) == 4000


async def test_instagram_post_is_apify_first(monkeypatch):
    """A non-reel IG post (/p/) tries Apify FIRST — its post scraper returns the caption + every
    carousel slide, where yt-dlp on a mixed carousel only gets the video slide. yt-dlp must not
    run at all when Apify succeeds."""
    async def _no_download(url):
        raise AssertionError("yt-dlp must not run when Apify succeeds for a /p/ post")

    async def fake_apify(url):
        return ContentBundle(kind="text", text="10 cafes in Lisbon", strategy="apify_carousel",
                             images=["https://cdn/1.jpg"], metadata={"platform": "instagram"})

    monkeypatch.setattr(sv, "_meta_ytdlp", _no_download)
    monkeypatch.setattr(sv, "_apify_tier", fake_apify)

    bundle = await sv.acquire("https://www.instagram.com/p/DY6zt0_DE3v/")
    assert bundle.strategy == "apify_carousel"
    assert bundle.text == "10 cafes in Lisbon"


async def test_instagram_reel_is_ytdlp_first(monkeypatch):
    """Reels stay yt-dlp-first (cheaper, usually works): the download is attempted before Apify."""
    order = []

    async def fake_download(url):
        order.append("download")
        return {}

    async def fake_apify(url):
        order.append("apify")
        return None

    monkeypatch.setattr(sv, "_meta_ytdlp", fake_download)
    monkeypatch.setattr(sv, "_apify_tier", fake_apify)
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(_OG_HTML))

    bundle = await sv.acquire("https://www.instagram.com/reel/ZZZ/")
    assert order == ["download", "apify"]  # yt-dlp attempted before Apify
    assert bundle.strategy == "social_og"


async def test_instagram_post_apify_miss_falls_to_ytdlp_then_og(monkeypatch):
    """When Apify-first misses on a /p/ post, fall through to yt-dlp, then og-caption — and don't
    re-attempt the (paid) Apify scrape a second time."""
    apify_calls = {"n": 0}

    async def fake_apify(url):
        apify_calls["n"] += 1
        return None  # miss

    monkeypatch.setattr(sv, "_apify_tier", fake_apify)
    monkeypatch.setattr(sv, "_meta_ytdlp", _raise_download_block)  # yt-dlp blocked
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(_OG_HTML))

    bundle = await sv.acquire("https://www.instagram.com/p/DY6zt0_DE3v/")
    assert bundle.strategy == "social_og"
    assert "Best 3 cafes in Lisbon" in bundle.text
    assert apify_calls["n"] == 1  # tried once, not re-attempted in the ladder


async def test_apify_cap_reached_falls_through_to_og(monkeypatch):
    """When the global daily Apify cap is hit, reserve returns False → no scrape, og-caption."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "tok")
    monkeypatch.setattr(sv, "_meta_ytdlp", _raise_download_block)
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


async def test_ytdlp_caption_long_enough_stops_at_tier_one(monkeypatch):
    """A full caption passes T1 as `reel_caption` (via ytdlp) without touching Apify."""
    async def meta(url):
        return {"title": "t", "description": "x" * 200, "duration": 30,
                "thumbnail": "https://cdn/t.jpg"}

    async def no_apify(url):
        raise AssertionError("apify must not run when the caption is long enough")

    monkeypatch.setattr(sv, "_meta_ytdlp", meta)
    monkeypatch.setattr(sv, "_apify_tier", no_apify)
    bundle = await sv.acquire("https://www.instagram.com/reel/ZZZ/")
    assert bundle.strategy == "reel_caption"
    assert bundle.metadata["via"] == "ytdlp" and bundle.metadata["tier"] == "caption"
    assert bundle.images == ["https://cdn/t.jpg"]


async def test_apify_video_becomes_reel_caption_with_comments(monkeypatch):
    """Apify reel: reel_caption, via apify, comments appended, media_url kept for T2, and the
    thumbnail is NOT sent as vision input (it would reroute a reel to the vision model)."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "tok")

    async def reserve():
        return True

    async def fetch(url):
        return {"caption": "short", "title": "t", "video_url": "https://cdn/v.mp4",
                "thumbnail": "https://cdn/t.jpg", "images": ["https://cdn/t.jpg"],
                "comments": ["1 cup flour, 2 eggs"], "duration": 20}

    async def no_images(urls, **kw):
        raise AssertionError("no image fetch for a video post")

    monkeypatch.setattr("services.firebase.reserve_apify_slot", reserve)
    monkeypatch.setattr("services.apify.fetch", fetch)
    monkeypatch.setattr(sv, "_fetch_image_parts", no_images)
    bundle = await sv._apify_tier("https://www.instagram.com/reel/ZZZ/")
    assert bundle.strategy == "reel_caption"
    assert bundle.metadata["via"] == "apify" and bundle.metadata["media_url"] == "https://cdn/v.mp4"
    assert "Top comments" in bundle.text and "1 cup flour" in bundle.text
    assert bundle.image_parts == []


async def test_empty_caption_ytdlp_returns_textless_reel_caption(monkeypatch):
    """yt-dlp metadata ok but no caption, Apify empty -> reel_caption with text=None (never
    'Video by <user>') so the gate escalates to transcript/frames."""
    async def meta(url):
        return {"title": "Video by someone", "description": "", "duration": 30}

    async def no_apify(url):
        return None

    monkeypatch.setattr(sv, "_meta_ytdlp", meta)
    monkeypatch.setattr(sv, "_apify_tier", no_apify)
    bundle = await sv.acquire("https://www.instagram.com/reel/ZZZ/")
    assert bundle.strategy == "reel_caption" and bundle.text is None
    assert bundle.metadata["via"] == "ytdlp"


async def test_login_wall_description_and_image_are_ignored(monkeypatch):
    html = ('<meta property="og:title" content="Instagram">'
            '<meta property="og:description" content="Log in to Instagram to see photos">'
            '<meta property="og:image" content="https://static/logo.png">')
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(html))
    bundle = await sv._caption_fallback("https://www.instagram.com/p/XYZ/")
    assert bundle.strategy == "private_or_blocked" and not bundle.images


async def test_wall_description_with_real_title_is_blocked(monkeypatch):
    html = ('<meta property="og:title" content="Some Page">'
            '<meta property="og:description" content="Create an account or log in to Facebook">'
            '<meta property="og:image" content="https://static/logo.png">')
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _FakeClient(html))
    bundle = await sv._caption_fallback("https://www.facebook.com/reel/1")
    assert bundle.strategy == "private_or_blocked"
