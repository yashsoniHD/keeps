"""Reel cascade tiers 2-3: one cached download, ffmpeg argv, Whisper, <15 words = no speech.
ffmpeg, Whisper and downloads are all faked — nothing touches the network or a real binary."""
import asyncio
import os

import pytest

import services.sources.social_video as sv
from models.note import ContentBundle


class _Proc:
    returncode = 0

    async def wait(self):
        return 0

    def kill(self):
        pass


@pytest.fixture
def ffmpeg(monkeypatch):
    """Record each ffmpeg argv; a frames call drops two jpgs next to the input."""
    calls = []

    async def fake_exec(*argv, **kw):
        calls.append(list(argv))
        if any(a.startswith("-frames:v") or a == "-frames:v" for a in argv):
            d = os.path.dirname(argv[3])
            for i in (1, 2):
                open(os.path.join(d, f"f_{i:02d}.jpg"), "wb").write(b"jpg")
        return _Proc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    return calls


@pytest.fixture
def media(monkeypatch, tmp_path):
    """`_download_media` stand-in that writes a file and counts calls."""
    monkeypatch.setattr(sv.settings, "TEMP_DOWNLOAD_DIR", str(tmp_path))
    n = {"calls": 0}

    async def fake_dl(url, workdir=None):
        n["calls"] += 1
        p = tmp_path / f"dl{n['calls']}.mp4"
        p.write_bytes(b"video")
        return str(p)

    monkeypatch.setattr(sv, "_download_media", fake_dl)
    return n


def _bundle(**meta):
    return ContentBundle(kind="text", text="caption", strategy="reel_caption",
                         metadata={"media_url": "https://cdn/v.mp4", "tier": "caption",
                                   "duration": 30, **meta})


def _whisper(monkeypatch, text):
    monkeypatch.setattr("services.gemini.gemini_service.transcribe", lambda path, duration_s=0: text)


async def test_transcript_tier_appends_speech_and_renames_strategy(ffmpeg, media, monkeypatch):
    _whisper(monkeypatch, "add two cups of flour and one cup of sugar then mix well and bake "
                          "for thirty minutes at one eighty")
    nb = await sv.escalate("https://www.instagram.com/reel/A/", _bundle())
    assert nb.strategy == "reel_transcript"
    assert "Spoken transcript" in nb.text and "two cups of flour" in nb.text
    argv = ffmpeg[0]
    assert argv[:3] == ["ffmpeg", "-y", "-i"]
    assert argv[argv.index("-vn"):argv.index("-vn") + 8] == [
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a"]
    assert "32k" in argv and argv[-1].endswith("a.mp3")


async def test_under_15_words_is_no_speech_and_falls_to_frames(ffmpeg, media, monkeypatch):
    _whisper(monkeypatch, "thanks for watching")
    nb = await sv.escalate("https://www.instagram.com/reel/A/", _bundle(duration=60))
    assert nb.strategy == "reel_frames"
    assert "Spoken transcript" not in nb.text
    assert len(nb.image_parts) == 2 and nb.image_parts[0]["mime_type"] == "image/jpeg"
    frames_argv = ffmpeg[1]
    assert "-vf" in frames_argv
    # duration-aware fps: 8 frames over 60 s -> 0.1333, scaled to 768 px wide
    assert frames_argv[frames_argv.index("-vf") + 1] == "fps=0.1333,scale=768:-2"
    assert frames_argv[frames_argv.index("-frames:v") + 1] == "8"
    assert frames_argv[frames_argv.index("-q:v") + 1] == "5"
    assert frames_argv[-1].endswith("f_%02d.jpg")


async def test_short_reel_fps_capped_at_half(ffmpeg, media, monkeypatch):
    _whisper(monkeypatch, "")
    await sv.escalate("u", _bundle(duration=10))
    vf = next(a for c in ffmpeg for a in c if a.startswith("fps="))
    assert vf.startswith("fps=0.5000")


async def test_transcript_then_frames_downloads_once(ffmpeg, media, monkeypatch):
    _whisper(monkeypatch, "word " * 30)
    b = _bundle()
    b1 = await sv.escalate("u", b)
    assert b1.strategy == "reel_transcript"
    b2 = await sv.escalate("u", b1)
    assert b2.strategy == "reel_frames"
    assert "Spoken transcript" in b2.text          # transcript kept when frames are added
    assert media["calls"] == 1                      # ONE download for the whole job
    assert await sv.escalate("u", b2) is None       # nothing past frames


async def test_download_failure_ends_cascade_and_is_cached(ffmpeg, monkeypatch):
    calls = []

    async def fail(url, workdir=None):
        calls.append(url)
        return None

    monkeypatch.setattr(sv, "_download_media", fail)
    b = _bundle()
    assert await sv.escalate("u", b) is None
    assert await sv.escalate("u", b) is None
    assert len(calls) == 1 and ffmpeg == []


async def test_ytdlp_download_used_when_no_media_url(ffmpeg, monkeypatch, tmp_path):
    monkeypatch.setattr(sv.settings, "TEMP_DOWNLOAD_DIR", str(tmp_path))
    src = tmp_path / "x.mp4"
    src.write_bytes(b"v")
    monkeypatch.setattr(sv, "_download", lambda url, workdir=None: (str(src), {}))
    _whisper(monkeypatch, "word " * 20)
    b = ContentBundle(kind="text", text="c", strategy="reel_caption",
                      metadata={"tier": "caption", "duration": 10})
    nb = await sv.escalate("https://www.tiktok.com/@u/video/1", b)
    assert nb.strategy == "reel_transcript"


async def test_overlong_video_is_not_downloaded(ffmpeg, media):
    b = _bundle(duration=sv.settings.MAX_VIDEO_SECONDS + 1)
    assert await sv.escalate("u", b) is None
    assert media["calls"] == 0


async def test_cleanup_removes_workdir(ffmpeg, media, monkeypatch):
    _whisper(monkeypatch, "word " * 20)
    nb = await sv.escalate("u", _bundle())
    workdir = nb.metadata["workdir"]
    assert os.path.isdir(workdir)
    sv.cleanup(nb)
    assert not os.path.exists(workdir)
    sv.cleanup(None)  # tolerant


async def test_ffmpeg_timeout_kills_process(monkeypatch):
    killed = []

    class Hang(_Proc):
        async def wait(self):
            await asyncio.sleep(0 if killed else 10)

        def kill(self):
            killed.append(True)

    async def fake_exec(*a, **k):
        return Hang()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(sv, "FFMPEG_TIMEOUT_SECONDS", 0.01)
    assert await sv._ffmpeg("-y") is False and killed


async def test_apify_called_once_across_tiers(ffmpeg, media, monkeypatch):
    """T1's single Apify call supplies media_url; T2/T3 reuse it, never re-scraping."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "tok")
    n = {"fetch": 0}

    async def reserve():
        return True

    async def fetch(url):
        n["fetch"] += 1
        return {"caption": "short", "title": "t", "video_url": "https://cdn/v.mp4",
                "images": [], "thumbnail": None, "comments": [], "duration": 20}

    async def no_meta(url):
        return {}

    monkeypatch.setattr("services.firebase.reserve_apify_slot", reserve)
    monkeypatch.setattr("services.apify.fetch", fetch)
    monkeypatch.setattr(sv, "_meta_ytdlp", no_meta)
    _whisper(monkeypatch, "")
    b = await sv.acquire("https://www.instagram.com/reel/A/")
    assert b.strategy == "reel_caption"
    b = await sv.escalate("https://www.instagram.com/reel/A/", b)
    assert b.strategy == "reel_frames"
    assert n["fetch"] == 1


async def test_cancelled_download_removes_partial_file(monkeypatch, tmp_path):
    """wait_for cancellation raises CancelledError (not Exception): the partial file must go."""
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "")

    class _Stream:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def raise_for_status(self):
            pass

        async def aiter_bytes(self, n):
            yield b"partial"
            await asyncio.sleep(10)

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, *a, **kw):
            return _Stream()

    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _Client())
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sv._download_media("https://cdn/v.mp4", str(tmp_path)), 0.2)
    assert os.listdir(tmp_path) == []


def test_transcribe_meters_call_and_estimates_cost_without_usage():
    from types import SimpleNamespace

    from services import gemini
    from services.usage_meter import start_metering

    class _Tr:
        def create(self, **kw):
            return SimpleNamespace(text=" hi ")  # Whisper: no usage at all

    svc = gemini.GeminiService.__new__(gemini.GeminiService)
    svc.client = SimpleNamespace(audio=SimpleNamespace(transcriptions=_Tr()))
    m = start_metering()
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3") as f:
        assert svc.transcribe(f.name, 10) == "hi"
    assert m.calls == 1 and m.cost_usd == pytest.approx(10 * gemini.WHISPER_PRICE_PER_SEC)
