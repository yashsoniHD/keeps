"""social_video: the video-file ladder, the 6 h acquisition cache, thin fallbacks, carousels.

Every network rung is stubbed at module level; the ladder logic runs for real.
"""
import shutil
import subprocess

import pytest

import services.apify as apify
import services.sources.social_video as sv

IG_REEL = "https://www.instagram.com/reel/ABC123/"
TIKTOK = "https://www.tiktok.com/@u/video/1"


@pytest.fixture
def s(monkeypatch):
    """Ladder state: what each rung returns, plus call logs."""
    st = {"cache": None, "puts": [], "apify": None, "apify_calls": 0,
          "downloads": [], "dead": set(), "ytdlp": RuntimeError("blocked"), "og": None}

    async def cache_get(url):
        return st["cache"]

    async def cache_put(url, entry):
        st["puts"].append(entry)

    async def fetch_capped(url):
        st["apify_calls"] += 1
        return st["apify"]

    async def download(u, duration=0, *, failure=None):
        st["downloads"].append(u)
        if u in st["dead"] and failure is not None:
            failure["reason"] = "expired"
        return None if u in st["dead"] else (b"MP4:" + u.encode(), "video/mp4")

    def ytdlp(url):
        if isinstance(st["ytdlp"], Exception):
            raise st["ytdlp"]
        return st["ytdlp"]

    async def og(url):
        return st["og"] or sv._blocked_bundle(url, sv._platform(url))

    async def images(urls):
        return [{"mime_type": "image/jpeg", "data": u.encode()} for u in urls[:sv.MAX_SLIDES]]

    monkeypatch.setattr(sv.acq_cache, "get", cache_get)
    monkeypatch.setattr(sv.acq_cache, "put", cache_put)
    monkeypatch.setattr(apify, "fetch_capped", fetch_capped)
    monkeypatch.setattr(sv, "download_video", download)
    monkeypatch.setattr(sv, "_ytdlp_download", ytdlp)
    monkeypatch.setattr(sv, "_caption_fallback", og)
    monkeypatch.setattr(sv, "_fetch_image_parts", images)
    return st


def _apify_video(**kw):
    return {"video_url": "https://api.apify.com/v", "caption": "Dal recipe", "title": "Dal",
            "thumbnail": "https://cdn/t.jpg", "images": [], "comments": ["1 cup dal"], **kw}


async def test_instagram_goes_straight_to_apify_video(s):
    s["apify"] = _apify_video()
    b = await sv.acquire(IG_REEL)
    assert b.strategy == "reel_video" and s["apify_calls"] == 1
    assert s["downloads"] == ["https://api.apify.com/v"]
    assert b.metadata["comments"] == ["1 cup dal"] and "1 cup dal" in b.text
    assert s["puts"] and "video_bytes" not in s["puts"][0]   # metadata only in the cache


async def test_no_video_obtainable_is_thin_caption_bundle(s):
    s["apify"] = _apify_video()
    s["dead"].add("https://api.apify.com/v")
    b = await sv.acquire(IG_REEL)
    assert b.strategy == "reel_caption"
    assert b.metadata["thin"] is True and "video_bytes" not in b.metadata
    assert "Dal recipe" in b.text and b.images == ["https://cdn/t.jpg"]


async def test_nothing_anywhere_goes_to_og_then_blocked(s):
    b = await sv.acquire(IG_REEL)
    assert b.strategy == "private_or_blocked"
    assert s["puts"] == []


async def test_carousel_keeps_six_slides(s):
    s["apify"] = {"video_url": None, "caption": "10 cafes", "images":
                  [f"https://cdn/{i}.jpg" for i in range(6)], "thumbnail": "https://cdn/0.jpg"}
    b = await sv.acquire("https://www.instagram.com/p/XYZ/")
    assert b.strategy == "apify_carousel"
    assert len(b.image_parts) == 6 and b.images == ["https://cdn/0.jpg"]


async def test_tiktok_ytdlp_video_skips_apify(s):
    s["ytdlp"] = ({"description": "caption", "title": "t", "thumbnail": "https://cdn/t.jpg"},
                  b"BYTES", "video/mp4")
    b = await sv.acquire(TIKTOK)
    assert b.strategy == "reel_video" and b.metadata["video_bytes"] == b"BYTES"
    assert s["apify_calls"] == 0


async def test_tiktok_ytdlp_caption_used_when_apify_fails(s):
    s["ytdlp"] = ({"description": "free caption", "title": "t"}, None, "")
    b = await sv.acquire(TIKTOK)
    assert b.strategy == "reel_caption" and b.metadata["thin"] is True
    assert "free caption" in b.text
    assert s["puts"] == []          # a thin result after an Apify miss is never cached


async def test_tiktok_ytdlp_blocked_uses_apify_video(s):
    s["apify"] = _apify_video()
    b = await sv.acquire(TIKTOK)
    assert b.strategy == "reel_video" and s["apify_calls"] == 1
    assert s["downloads"] == ["https://api.apify.com/v"]


async def test_cache_hit_redownloads_without_rescraping(s):
    s["cache"] = {"caption": "cached", "media_url": "https://api.apify.com/v",
                  "strategy": "reel_video", "via": "apify"}
    b = await sv.acquire(IG_REEL)
    assert b.strategy == "reel_video" and b.metadata["caption"] == "cached"
    assert s["apify_calls"] == 0 and s["puts"] == []


async def test_cache_hit_with_expired_media_reruns_ladder(s):
    s["cache"] = {"caption": "cached", "media_url": "https://cdn/expired.mp4",
                  "strategy": "reel_video"}
    s["dead"].add("https://cdn/expired.mp4")
    s["apify"] = _apify_video()
    b = await sv.acquire(IG_REEL)
    assert s["apify_calls"] == 1 and b.metadata["video_bytes"]
    assert s["puts"][0]["media_url"] == "https://api.apify.com/v"


async def test_cached_carousel_is_reused(s):
    s["cache"] = {"caption": "c", "images": ["https://cdn/a.jpg", "https://cdn/b.jpg"],
                  "strategy": "apify_carousel"}
    b = await sv.acquire("https://www.instagram.com/p/XYZ/")
    assert b.strategy == "apify_carousel" and len(b.image_parts) == 2
    assert s["apify_calls"] == 0


# ---- unit pieces ----

class _Resp:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        pass


class _Client:
    def __init__(self, text):
        self._t = text

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, headers=None):
        if isinstance(self._t, Exception):
            raise self._t
        return _Resp(self._t)


_OG_HTML = """<html><head>
<meta property="og:title" content="traveler on Instagram">
<meta property="og:description" content="traveler: Best 3 cafes in Lisbon">
<meta property="og:image" content="https://cdn/poster.jpg"></head></html>"""


async def test_og_fallback_is_thin_and_has_no_oembed(monkeypatch):
    calls = []

    def client(**kw):
        calls.append(1)
        return _Client(_OG_HTML)

    async def no_images(urls):
        return []

    monkeypatch.setattr(sv, "guarded_async_client", client)
    monkeypatch.setattr(sv, "_fetch_image_parts", no_images)
    b = await sv._caption_fallback("https://www.instagram.com/p/X/")
    assert b.strategy == "social_og" and b.metadata["thin"] is True
    assert "Best 3 cafes" in b.text and len(calls) == 1   # one og fetch, no oEmbed call


async def test_og_login_wall_is_blocked(monkeypatch):
    wall = '<meta property="og:title" content="Instagram"><meta property="og:description" content="x">'
    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _Client(wall))
    b = await sv._caption_fallback(IG_REEL)
    assert b.strategy == "private_or_blocked" and b.text is None


async def test_image_parts_parallel_capped_and_ordered(monkeypatch):
    async def fetch(u, cap):
        return None if u.endswith("2.jpg") else {"mime_type": "image/jpeg", "data": u.encode()}

    monkeypatch.setattr(sv, "_fetch_image", fetch)
    parts = await sv._fetch_image_parts([f"https://cdn/{i}.jpg" for i in range(10)])
    assert [p["data"] for p in parts] == [f"https://cdn/{i}.jpg".encode() for i in (0, 1, 3, 4, 5)]


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
async def test_downscale_caps_width_at_768():
    png = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i",
                          "color=c=red:s=1600x900", "-frames:v", "1", "-f", "image2pipe",
                          "-c:v", "png", "pipe:1"], capture_output=True, check=True).stdout
    out = await sv._downscale(png)
    assert out and out[:2] == b"\xff\xd8"                      # JPEG
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", "-"], input=out, capture_output=True).stdout
    assert probe.decode().strip() == "768,432"
    assert await sv._downscale(b"not an image") is None


def _fake_ydl(duration, size):
    class _YDL:
        downloads = 0

        def __init__(self, opts):
            self.dir = opts["outtmpl"].rsplit("/", 1)[0]
            self.params = opts
            assert opts["max_filesize"] == sv.raw_cap()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def extract_info(self, url, download):
            assert download is False            # metadata first, always
            return {"description": "c", "duration": duration}

        def process_ie_result(self, info, download):
            type(self).downloads += 1
            open(f"{self.dir}/x.mp4", "wb").write(b"0" * size)
    return _YDL


async def test_ytdlp_duration_gate_skips_download(monkeypatch, tmp_path):
    monkeypatch.setattr(sv.settings, "TEMP_DOWNLOAD_DIR", str(tmp_path))
    ydl = _fake_ydl(sv.settings.MAX_VIDEO_SECONDS + 1, 11)
    monkeypatch.setattr(sv.yt_dlp, "YoutubeDL", ydl)
    info, data, _ = sv._ytdlp_download(TIKTOK)
    assert data is None and ydl.downloads == 0 and info["description"] == "c"


async def test_ytdlp_oversized_file_is_reencoded(monkeypatch, tmp_path):
    monkeypatch.setattr(sv.settings, "TEMP_DOWNLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(sv.settings, "VIDEO_MAX_BYTES", 10)
    monkeypatch.setattr(sv.yt_dlp, "YoutubeDL", _fake_ydl(30, 11))
    calls = []
    monkeypatch.setattr(sv, "_reencode", lambda path, d, **kw: calls.append(d) or b"small")
    assert sv._ytdlp_download(TIKTOK)[1:] == (b"small", "video/mp4") and calls == [30]
    monkeypatch.setattr(sv.settings, "VIDEO_MAX_BYTES", 100)
    assert sv._ytdlp_download(TIKTOK)[1] == b"0" * 11      # fits → untouched
    assert list(tmp_path.iterdir()) == []                 # temp dirs always removed


async def test_too_long_ytdlp_with_caption_skips_apify(s):
    s["ytdlp"] = ({"description": "a 3 hour podcast", "duration": 3 * 3600}, None, "")
    b = await sv.acquire(TIKTOK)
    assert b.strategy == "reel_caption" and b.metadata["too_long"] is True
    assert b.metadata["duration"] == 3 * 3600 and b.metadata["thin"] is True
    assert s["apify_calls"] == 0 and s["downloads"] == []


async def test_too_long_apify_video_is_not_downloaded(s):
    s["apify"] = _apify_video(duration=2 * 3600)
    b = await sv.acquire(IG_REEL)
    assert b.metadata["too_long"] is True and s["downloads"] == []
    assert s["apify_calls"] == 1 and "video_bytes" not in b.metadata
    assert s["puts"][0]["too_long"] is True and s["puts"][0]["duration"] == 7200


async def test_oversized_download_with_unknown_duration_is_dropped(monkeypatch):
    monkeypatch.setattr(sv.settings, "VIDEO_MAX_BYTES", 2)
    seen = {}
    monkeypatch.setattr(sv, "guarded_async_client",
                        lambda **kw: _StreamClient(_StreamResp("video/mp4", b"12345"), seen))
    assert await sv.download_video("https://cdn/v.mp4") is None
    monkeypatch.setattr(sv, "_reencode", lambda path, d, **kw: b"ok")
    assert await sv.download_video("https://cdn/v.mp4", 30) == (b"ok", "video/mp4")


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")
async def test_real_reencode_fits_the_cap(monkeypatch, tmp_path):
    src = tmp_path / "in.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=f=440",
                    "-t", "4", "-c:v", "libx264", "-b:v", "4M", "-c:a", "aac", "-shortest",
                    str(src)], check=True)
    monkeypatch.setattr(sv.settings, "VIDEO_MAX_BYTES", src.stat().st_size // 3)
    out = sv._reencode(str(src), 4)
    assert out and len(out) <= sv.settings.VIDEO_MAX_BYTES
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v",
                            "-show_entries", "stream=height", "-of", "csv=p=0", "-"],
                           input=out, capture_output=True).stdout
    assert probe.decode().strip() == "360"
    assert sv._reencode(str(src), 0) is None             # unknown duration → no re-encode


class _StreamResp:
    def __init__(self, ct, body=b"x"):
        self.headers = {"content-type": ct}
        self._body = body

    def raise_for_status(self):
        pass

    async def aiter_bytes(self, n):
        yield self._body


class _StreamClient:
    def __init__(self, resp, seen):
        self._r, self._seen = resp, seen

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def stream(self, method, url, headers=None):
        self._seen["headers"] = headers
        r = self._r

        class _Ctx:
            async def __aenter__(self):
                return r

            async def __aexit__(self, *a):
                return False
        return _Ctx()


async def test_download_rejects_html_and_scopes_apify_token(monkeypatch):
    seen = {}
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "sekret")
    monkeypatch.setattr(sv, "guarded_async_client",
                        lambda **kw: _StreamClient(_StreamResp("text/html"), seen))
    assert await sv.download_video("https://cdn.ig/v.mp4") is None      # login page, not video
    monkeypatch.setattr(sv, "guarded_async_client",
                        lambda **kw: _StreamClient(_StreamResp("video/mp4", b"MP4"), seen))
    assert await sv.download_video("https://evil.com/?api.apify.com") == (b"MP4", "video/mp4")
    assert "Authorization" not in seen["headers"]                        # host check, not substring
    await sv.download_video("https://api.apify.com/v2/key-value-stores/s/records/v")
    assert seen["headers"]["Authorization"] == "Bearer sekret"


async def test_failed_fresh_download_keeps_media_for_next_acquisition(s):
    s["apify"] = _apify_video()
    s["dead"].add("https://api.apify.com/v")
    first = await sv.acquire(IG_REEL)
    assert first.metadata["thin"] is True
    cached = s["puts"][0]
    assert cached["media_url"] == "https://api.apify.com/v"
    assert cached["strategy"] == "reel_video"
    s["cache"] = cached
    s["dead"].clear()
    second = await sv.acquire(IG_REEL)
    assert second.metadata["video_bytes"]
    assert s["apify_calls"] == 1


async def test_partial_carousel_marks_missing_visual_evidence(s, monkeypatch):
    s["apify"] = {"caption": "cafes", "images": ["https://cdn/a", "https://cdn/b"]}
    async def partial(urls):
        return [{"mime_type": "image/jpeg", "data": b"a"}]
    monkeypatch.setattr(sv, "_fetch_image_parts", partial)
    b = await sv.acquire(IG_REEL)
    assert b.metadata["thin"] is True
    assert b.metadata["slides"] == 1 and b.metadata["slides_expected"] == 2


async def test_zero_cached_slides_refreshes_once_and_remains_thin(s, monkeypatch):
    s["cache"] = {"caption": "cached", "images": ["https://cdn/expired"],
                  "strategy": "apify_caption"}
    s["apify"] = {"caption": "fresh", "images": ["https://cdn/new"]}
    async def missing(urls):
        return []
    monkeypatch.setattr(sv, "_fetch_image_parts", missing)
    b = await sv.acquire(IG_REEL)
    assert s["apify_calls"] == 1
    assert b.metadata["thin"] is True and b.metadata["slides"] == 0


async def test_download_rejects_json_success_response(monkeypatch):
    monkeypatch.setattr(sv, "guarded_async_client",
                        lambda **kw: _StreamClient(_StreamResp("application/json", b'{"error":1}'), {}))
    assert await sv.download_video("https://cdn/v.mp4") is None


@pytest.mark.parametrize("status, expected_attempts", [(429, 2), (503, 2), (403, 1), (404, 1)])
async def test_download_retries_only_transient_http_failure(monkeypatch, status, expected_attempts):
    import httpx
    attempts = []
    class Response(_StreamResp):
        def raise_for_status(self):
            if len(attempts) == 1:
                raise httpx.HTTPStatusError("failure", request=httpx.Request("GET", "https://cdn/v"),
                                            response=httpx.Response(status))
    def client(**kwargs):
        attempts.append(1)
        return _StreamClient(Response("video/mp4", b"MP4"), {})
    monkeypatch.setattr(sv, "guarded_async_client", client)
    result = await sv.download_video("https://cdn/v")
    assert len(attempts) == expected_attempts
    assert bool(result) == (expected_attempts == 2)


async def test_failed_cached_media_refresh_keeps_cached_caption(s):
    s["cache"] = {"caption": "Useful cached recipe", "media_url": "https://cdn/expired",
                  "thumbnail": "https://cdn/cover", "strategy": "reel_video"}
    s["dead"].add("https://cdn/expired")
    b = await sv.acquire(IG_REEL)
    assert b.metadata["thin"] is True and "Useful cached recipe" in b.text
    assert b.images == ["https://cdn/cover"] and s["apify_calls"] == 1


async def test_capped_carousel_marks_unseen_slides_thin(s):
    s["apify"] = {"caption": "10 cafes", "images": [f"https://cdn/{i}" for i in range(6)],
                  "image_count": 10}
    b = await sv.acquire(IG_REEL)
    assert len(b.image_parts) == 6
    assert b.metadata["slides_available"] == 10 and b.metadata["slides_expected"] == 6
    assert b.metadata["thin"] is True


async def test_cached_transient_retries_url_without_paid_refresh(s, monkeypatch):
    s["cache"] = {"caption": "cached", "media_url": "https://cdn/v",
                  "strategy": "reel_video", "download_failure": "transient"}
    async def transient(u, duration=0, *, failure=None):
        failure["reason"] = "transient"
        return None
    monkeypatch.setattr(sv, "download_video", transient)
    b = await sv.acquire(IG_REEL)
    assert b.metadata["thin"] is True and s["apify_calls"] == 0
    assert s["puts"][-1]["media_url"] == "https://cdn/v"


@pytest.mark.parametrize("content_type,body", [("application/json", b'{}'), ("video/mp4", b'12345')])
async def test_terminal_type_or_size_failure_never_rescrapes(s, monkeypatch, content_type, body):
    monkeypatch.setattr(sv.settings, "VIDEO_MAX_BYTES", 2)
    monkeypatch.setattr(sv, "download_video", sv_download_original)
    monkeypatch.setattr(sv, "guarded_async_client",
                        lambda **kw: _StreamClient(_StreamResp(content_type, body), {}))
    s["apify"] = _apify_video()
    b = await sv.acquire(IG_REEL)
    assert b.metadata["thin"] is True
    s["cache"] = s["puts"][-1]
    assert s["cache"]["download_failure"] == "permanent"
    await sv.acquire(IG_REEL)
    assert s["apify_calls"] == 1


sv_download_original = sv.download_video


async def test_reencode_environment_failure_is_transient(monkeypatch, tmp_path):
    monkeypatch.setattr(sv.subprocess, "run", lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError()))
    failure = {}
    assert sv._reencode(str(tmp_path / "video"), 60, failure=failure) is None
    assert failure["reason"] == "transient"


async def test_download_deadline_expiry_is_transient(monkeypatch):
    import asyncio
    async def wait(*a, **kw):
        a[0].close()
        raise asyncio.TimeoutError()
    monkeypatch.setattr(sv.asyncio, "wait_for", wait)
    failure = {}
    assert await sv.download_video("https://cdn/v", failure=failure) is None
    assert failure["reason"] == "transient"
