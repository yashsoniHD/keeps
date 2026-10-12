"""YouTube: direct model URL first; the fallback scraper when the model can't read it."""
import json

import pytest

import services.apify as apify
import services.sources.social_video as sv
import services.sources.youtube as yt

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
LONG_TX = "word " * 100  # 500 chars


def _page(duration, tracks=()):
    return {"duration": duration, "title": "T", "author": "A", "description": "desc",
            "thumbnail": "https://i.ytimg.com/x.jpg", "tracks": list(tracks)}


@pytest.fixture
def stubs(monkeypatch):
    s = {"page": _page(600, [{"baseUrl": "x"}]), "transcript": None, "apify": None,
         "apify_calls": 0, "dead": False}

    async def watch(vid):
        if isinstance(s["page"], Exception):
            raise s["page"]
        return s["page"]

    async def oembed(url):
        return {"title": "OE title", "author_name": "OE author"}

    async def transcript(tracks):
        return s["transcript"]

    async def fetch_capped(url):
        s["apify_calls"] += 1
        return s["apify"]

    async def download(u, duration=0):
        return None if s["dead"] else (b"MP4", "video/mp4")

    monkeypatch.setattr(yt, "_watch_page", watch)
    monkeypatch.setattr(yt, "_oembed", oembed)
    monkeypatch.setattr(yt, "_fetch_transcript", transcript)
    monkeypatch.setattr(apify, "fetch_capped", fetch_capped)
    monkeypatch.setattr(sv, "download_video", download)
    return s


async def test_any_length_under_an_hour_goes_direct(stubs):
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_direct" and b.video_uri == URL
    assert b.metadata["title"] == "T" and b.images == ["https://i.ytimg.com/x.jpg"]
    assert stubs["apify_calls"] == 0


async def test_blocked_page_uses_oembed_and_still_goes_direct(stubs):
    stubs["page"] = RuntimeError("consent wall")
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_direct" and b.metadata["title"] == "OE title"
    assert b.images == ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]


async def test_over_an_hour_skips_straight_to_fallback(stubs):
    stubs["page"] = _page(yt.settings.YOUTUBE_MAX_DIRECT_SECONDS + 1)
    stubs["apify"] = {"subtitles": "subs " * 50}
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_fallback" and b.metadata["via"] == "apify"


async def test_fallback_prefers_free_captions(stubs):
    stubs["transcript"] = LONG_TX
    b = await yt.fallback(URL, await yt.acquire(URL))
    assert b.strategy == "youtube_fallback" and b.text == LONG_TX
    assert b.metadata["via"] == "captions" and "caption_tracks" not in b.metadata
    assert stubs["apify_calls"] == 0


async def test_fallback_apify_mp4_goes_to_video_model(stubs):
    stubs["apify"] = {"video_url": "https://cdn/v.mp4", "subtitles": "s"}
    b = await yt.fallback(URL, await yt.acquire(URL))
    assert b.strategy == "youtube_fallback_video"
    assert b.metadata["video_bytes"] == b"MP4" and b.images == ["https://i.ytimg.com/x.jpg"]


async def test_fallback_apify_subtitles_when_no_mp4(stubs):
    stubs["apify"] = {"video_url": "https://cdn/v.mp4", "subtitles": "subs " * 50}
    stubs["dead"] = True
    b = await yt.fallback(URL, await yt.acquire(URL))
    assert b.strategy == "youtube_fallback" and b.metadata["via"] == "apify"


async def test_fallback_with_nothing_is_metadata_only_never_the_url(stubs):
    b = await yt.acquire(URL)
    b.metadata.update(description="", title="Untitled")
    out = await yt.fallback(URL, b)
    assert out.kind == "metadata_only" and out.text is None


async def test_fallback_last_resort_is_thin_description(stubs):
    b = await yt.fallback(URL, await yt.acquire(URL))
    assert b.text == "desc" and b.metadata["thin"] is True and b.metadata["via"] == "description"


def test_parse_player_response():
    pr = {"videoDetails": {"lengthSeconds": "125", "title": "Hi", "author": "Me",
                           "shortDescription": "d", "thumbnail": {"thumbnails": [
                               {"url": "a"}, {"url": "b"}]}},
          "captions": {"playerCaptionsTracklistRenderer": {"captionTracks": [
              {"baseUrl": "https://www.youtube.com/api/timedtext?v=1", "languageCode": "en"}]}}}
    html = f"<html><script>var x=1; var ytInitialPlayerResponse = {json.dumps(pr)};var y=2;</script>"
    got = yt._parse_player_response(html)
    assert got["duration"] == 125 and got["title"] == "Hi" and got["thumbnail"] == "b"
    assert got["tracks"][0]["languageCode"] == "en"
    assert yt._parse_player_response("<html>consent wall</html>") is None


def test_captions_text_json3_and_xml():
    assert yt._captions_text(json.dumps({"events": [{"segs": [{"utf8": "hello "}]},
                                                    {"segs": [{"utf8": "world"}]}]})) == "hello world"
    assert yt._captions_text('<transcript><text start="0">a &amp; b</text><text>c</text></transcript>') == "a & b c"


def test_captions_json3_keeps_timestamps_every_30s():
    ev = [{"tStartMs": t, "segs": [{"utf8": w}]} for t, w in
          [(0, "intro "), (12000, "more "), (31000, "step "), (95000, "end")]]
    text = " ".join(yt._captions_text(json.dumps({"events": ev})).split())
    assert text == "[00:00] intro more [00:31] step [01:35] end"



async def test_direct_threshold_comes_from_config(stubs, monkeypatch):
    monkeypatch.setattr(yt.settings, "YOUTUBE_MAX_DIRECT_SECONDS", 300)
    stubs["apify"] = {"subtitles": "subs " * 50}
    assert (await yt.acquire(URL)).strategy == "youtube_fallback"       # 600 s page > 300
    monkeypatch.setattr(yt.settings, "YOUTUBE_MAX_DIRECT_SECONDS", 3600)
    assert (await yt.acquire(URL)).strategy == "youtube_direct"


async def test_fallback_skips_mp4_over_the_file_limit(stubs, monkeypatch):
    stubs["page"] = _page(3 * 3600)
    stubs["apify"] = {"video_url": "https://cdn/v.mp4"}
    b = await yt.acquire(URL)                   # 3 h > direct limit → fallback, no mp4
    assert "video_bytes" not in b.metadata and b.text == "desc"
    assert b.metadata["too_long"] is True and b.metadata["built_from"] == "description"
