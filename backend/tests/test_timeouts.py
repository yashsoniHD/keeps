"""Timeout budget constants."""
import routers.process as process
import services.apify as apify
import services.sources.social_video as sv
from config import settings


def test_budget_constants():
    assert sv.DOWNLOAD_TIMEOUT_SECONDS == 45
    assert sv.FFMPEG_TIMEOUT_SECONDS == 15
    assert process.JOB_DEADLINE_S == 270
    assert settings.VIDEO_MAX_BYTES == 25_000_000
    assert settings.APIFY_DAILY_GLOBAL_CAP == 50


def test_apify_http_timeout_is_75(monkeypatch):
    seen = {}

    class C:
        def __init__(self, timeout):
            seen["t"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, *a, **k):
            class R:
                def raise_for_status(self):
                    pass

                def json(self):
                    return []
            return R()

    monkeypatch.setattr(apify.httpx, "Client", C)
    monkeypatch.setattr(apify.settings, "APIFY_TOKEN", "t")
    apify._run(apify._registry()["instagram_reel"], "https://www.instagram.com/reel/A/")
    assert seen["t"] == 75.0
