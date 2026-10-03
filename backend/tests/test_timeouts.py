"""Timeout budget constants + the deadline guard that skips escalation when over budget."""
import routers.process as process
import services.apify as apify
import services.sources.social_video as sv
from config import settings
from models.note import ContentBundle


def test_budget_constants():
    assert sv.DOWNLOAD_TIMEOUT_SECONDS == 30
    assert sv.META_TIMEOUT_SECONDS == 25
    assert sv.FFMPEG_TIMEOUT_SECONDS == 20
    assert process.JOB_DEADLINE_S == 270
    assert settings.MAX_VIDEO_SECONDS == 900
    assert settings.APIFY_DAILY_GLOBAL_CAP == 50
    assert settings.TRANSCRIBE_MODEL == "openai/whisper-large-v3-turbo"


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


def _reel(tier):
    return ContentBundle(kind="text", strategy="reel_caption", metadata={"tier": tier})


def test_deadline_guard_skips_escalation_over_budget(monkeypatch):
    now = 1000.0
    monkeypatch.setattr(process.time, "monotonic", lambda: now)
    # caption->transcript costs 115 (+45 finish margin): affordable up to 110 s elapsed
    assert process._can_escalate(_reel("caption"), start=now - 100, done=0)
    assert not process._can_escalate(_reel("caption"), start=now - 111, done=0)
    # transcript->frames costs 60: affordable up to 165 s
    assert process._can_escalate(_reel("transcript"), start=now - 160, done=0)
    assert not process._can_escalate(_reel("transcript"), start=now - 166, done=0)
    assert not process._can_escalate(_reel("frames"), start=now, done=0)       # last tier
    assert not process._can_escalate(_reel("caption"), start=now, done=2)      # max 2
