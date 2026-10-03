"""YouTube routing by duration/transcript; watch-page parsing; oEmbed fallback."""
import json

import pytest

import services.sources.youtube as yt

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
LONG_TX = "word " * 100  # 500 chars


def _page(duration, tracks=()):
    return {"duration": duration, "title": "T", "author": "A", "description": "desc",
            "thumbnail": "https://i.ytimg.com/x.jpg", "tracks": list(tracks)}


@pytest.fixture
def stubs(monkeypatch):
    s = {"page": _page(60), "transcript": None, "apify": None, "apify_calls": 0}

    async def watch(vid):
        if isinstance(s["page"], Exception):
            raise s["page"]
        return s["page"]

    async def oembed(url):
        return {"title": "OE title", "author_name": "OE author"}

    async def transcript(tracks):
        return s["transcript"]

    async def apify_subs(url):
        s["apify_calls"] += 1
        return s["apify"]

    monkeypatch.setattr(yt, "_watch_page", watch)
    monkeypatch.setattr(yt, "_oembed", oembed)
    monkeypatch.setattr(yt, "_fetch_transcript", transcript)
    monkeypatch.setattr(yt, "_apify_subtitles", apify_subs)
    return s


async def test_short_goes_direct(stubs):
    stubs["page"] = _page(150, [{"baseUrl": "x"}])
    stubs["transcript"] = LONG_TX      # ignored: Shorts always read by the video model
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_direct" and b.kind == "video_uri" and b.video_uri == URL


async def test_long_with_transcript_is_text_bundle(stubs):
    stubs["page"] = _page(600, [{"baseUrl": "x"}])
    stubs["transcript"] = LONG_TX
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_transcript" and b.kind == "text" and b.text == LONG_TX
    assert b.metadata["via"] == "captions" and b.video_uri is None


async def test_short_transcript_under_200_chars_is_ignored(stubs):
    stubs["page"] = _page(600, [{"baseUrl": "x"}])
    stubs["transcript"] = "too short"
    assert (await yt.acquire(URL)).strategy == "youtube_direct"


async def test_long_without_transcript_goes_direct_under_cap(stubs):
    stubs["page"] = _page(800)
    assert (await yt.acquire(URL)).strategy == "youtube_direct"
    assert stubs["apify_calls"] == 0


async def test_over_cap_uses_apify_subtitles(stubs):
    stubs["page"] = _page(901)
    stubs["apify"] = "subtitle text " * 30
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_transcript" and b.metadata["via"] == "apify"
    assert stubs["apify_calls"] == 1


async def test_over_cap_no_subtitles_is_description_only(stubs):
    stubs["page"] = _page(5000)
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_transcript" and b.text == "desc" and b.metadata["via"] == "description"


async def test_blocked_page_unknown_duration_uses_text_bundle(stubs):
    stubs["page"] = RuntimeError("429")
    b = await yt.acquire(URL)
    assert b.strategy == "youtube_transcript" and b.metadata["via"] == "description"
    assert b.text == "OE title"
    assert b.metadata["title"] == "OE title" and b.metadata["author"] == "OE author"
    assert b.images == ["https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"]


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


def test_no_yt_dlp_in_module():
    assert "yt_dlp" not in open(yt.__file__).read()


async def test_blocked_page_shorts_url_goes_direct(stubs):
    stubs["page"] = RuntimeError("429")
    b = await yt.acquire("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    assert b.strategy == "youtube_direct"
    assert b.metadata["title"] == "OE title"
