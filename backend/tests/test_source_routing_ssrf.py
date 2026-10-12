"""P1-1: source routing is by hostname, and yt-dlp can't be steered at internal addresses."""
import pytest
import yt_dlp

import services.sources.social_video as sv
from services.net_guard import BlockedURLError
from services.sources import product, reddit, twitter, youtube


@pytest.mark.parametrize("url,expected", [
    ("https://www.tiktok.com/@a/video/1", True),
    ("https://vm.tiktok.com/x", True),
    ("https://www.instagram.com/reel/ABC/", True),
    ("https://fb.watch/abc/", True),
    ("https://public.example/tiktok.com", False),
    ("https://tiktok.com.evil.example/x", False),
    ("https://nottiktok.com/x", False),
    ("https://public.example/?u=instagram.com", False),
])
def test_social_video_matches_hostname_only(url, expected):
    assert sv.matches(url) is expected


@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=abcdefghijk", True),
    ("https://youtu.be/abcdefghijk", True),
    ("https://music.youtube.com/watch?v=abcdefghijk", True),
    ("https://public.example/youtube.com", False),
    ("https://youtube.com.evil.example/x", False),
])
def test_youtube_matches_hostname_only(url, expected):
    assert youtube.matches(url) is expected


def test_other_matchers_hostname_only():
    assert twitter.matches("https://x.com/a/status/1")
    assert not twitter.matches("https://box.com/x")
    assert not twitter.matches("https://public.example/twitter.com")
    assert product.matches("https://www.amazon.in/dp/B0")
    assert product.matches("https://amzn.to/abc")
    assert product.matches("https://www.flipkart.com/p")
    assert not product.matches("https://public.example/amazon.in")
    assert not product.matches("https://flipkart.com.evil.example/p")
    assert reddit.matches("https://old.reddit.com/r/python/comments/1")
    assert reddit.matches("https://redd.it/abc")
    assert not reddit.matches("https://public.example/reddit.com/r/x")


def test_platform_uses_hostname():
    assert sv._platform("https://www.facebook.com/watch?v=1&ref=instagram") == "facebook"
    assert sv._platform("https://vm.tiktok.com/x") == "tiktok"


def test_ydl_opts_platform_extractors_only(tmp_path):
    opts = sv._ydl_opts(str(tmp_path))
    assert opts["allowed_extractors"]
    with yt_dlp.YoutubeDL(opts) as ydl:
        loaded = {k.lower() for k in ydl._ies}
    assert "generic" not in loaded
    assert {"tiktok", "tiktokvm", "facebook", "facebookreel", "instagram"} <= loaded
    assert all(k.startswith(("tiktok", "facebook", "instagram")) for k in loaded)


def test_ytdlp_download_blocks_private_media_hop(monkeypatch):
    calls = []

    class FakeYDL:
        def __init__(self, opts):
            self.params = opts

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download=False):
            return {"duration": 10, "url": "https://93.184.215.14/ok.mp4",
                    "formats": [{"url": "http://127.0.0.1/private.mp4"}]}

        def process_ie_result(self, info, download=True):
            calls.append(info)

    monkeypatch.setattr(sv.yt_dlp, "YoutubeDL", FakeYDL)
    with pytest.raises(BlockedURLError):
        sv._ytdlp_download("https://www.tiktok.com/@a/video/1")
    assert calls == []


async def test_ladder_does_not_swallow_blocked(monkeypatch):
    def boom(url):
        raise BlockedURLError("internal")

    async def no_apify(url):
        raise AssertionError("must not fall through to Apify")

    monkeypatch.setattr(sv, "_ytdlp_download", boom)
    monkeypatch.setattr(sv, "_apify_entry", no_apify)
    with pytest.raises(BlockedURLError):
        await sv._ladder("https://www.tiktok.com/@a/video/1")
