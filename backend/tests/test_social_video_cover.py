"""social_video.acquire cover resolution: frame-first (durable, local bytes) so a reel's
cover never depends on fetching Instagram's referer-gated, time-signed CDN thumbnail."""
import pytest

import services.sources.social_video as sv


@pytest.fixture
def fake_download(monkeypatch):
    """Stub the yt-dlp download to return a fake file path + info dict, and neutralise the
    GCS video upload + temp-file cleanup so acquire() runs without I/O."""
    state = {"thumbnail": None}

    def _dl(url):
        info = {"title": "Reel", "description": "cap", "duration": 12}
        if state["thumbnail"]:
            info["thumbnail"] = state["thumbnail"]
        return "/tmp/fake_reel.mp4", info

    monkeypatch.setattr(sv, "_download", _dl)
    monkeypatch.setattr(sv, "_upload_to_gcs", lambda p: "gs://bucket/media/x.mp4")
    monkeypatch.setattr(sv.os.path, "exists", lambda p: False)  # skip the finally-cleanup unlink
    monkeypatch.setattr(sv.settings, "CLOUD_STORAGE_BUCKET", "bucket")
    return state


async def test_frame_first_wins_over_platform_thumbnail(fake_download, monkeypatch):
    """A real frame is extracted → it's used even when info has a thumbnail URL; the
    expiring CDN URL is never passed downstream."""
    fake_download["thumbnail"] = "https://scontent.cdninstagram.com/expiring.jpg"

    async def fake_frame(path):
        return "https://storage.googleapis.com/covers-bucket/covers/abc.jpg"

    monkeypatch.setattr("services.covers.extract_video_frame", fake_frame)

    bundle = await sv.acquire("https://www.instagram.com/reel/XYZ/")
    assert bundle.images == ["https://storage.googleapis.com/covers-bucket/covers/abc.jpg"]
    assert bundle.video_uri == "gs://bucket/media/x.mp4"


async def test_falls_back_to_thumbnail_when_no_frame(fake_download, monkeypatch):
    """Frame extraction unavailable (e.g. COVERS_BUCKET unset) → use the platform
    thumbnail URL so process.py can attempt to re-host it."""
    fake_download["thumbnail"] = "https://scontent.cdninstagram.com/x.jpg"

    async def fake_frame(path):
        return None

    monkeypatch.setattr("services.covers.extract_video_frame", fake_frame)

    bundle = await sv.acquire("https://www.instagram.com/reel/XYZ/")
    assert bundle.images == ["https://scontent.cdninstagram.com/x.jpg"]


async def test_no_cover_when_neither_available(fake_download, monkeypatch):
    """No frame and no platform thumbnail → empty images; the note shows the placeholder."""
    fake_download["thumbnail"] = None

    async def fake_frame(path):
        return None

    monkeypatch.setattr("services.covers.extract_video_frame", fake_frame)

    bundle = await sv.acquire("https://www.instagram.com/reel/XYZ/")
    assert bundle.images == []
