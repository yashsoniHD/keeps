"""The Apify token must travel as an Authorization header, never in a URL (httpx logs URLs)."""
import asyncio

import services.apify as apify
import services.sources.social_video as sv


def test_run_sends_token_as_header(monkeypatch):
    seen = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return []

    class _Client:
        def __init__(self, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, **kw):
            seen.update(kw)
            return _Resp()

    monkeypatch.setattr(apify.httpx, "Client", _Client)
    monkeypatch.setattr(apify.settings, "APIFY_TOKEN", "sekret")
    actor = apify._Actor("a~b", lambda u: {"url": u})
    apify._run(actor, "https://x.com/p")
    assert seen["headers"] == {"Authorization": "Bearer sekret"}
    assert "params" not in seen


def test_download_video_keeps_token_out_of_url(monkeypatch):
    seen = {}

    class _Stream:
        async def __aenter__(self):
            raise RuntimeError("stop")

        async def __aexit__(self, *a):
            return False

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url, **kw):
            seen["url"], seen["headers"] = url, kw["headers"]
            return _Stream()

    monkeypatch.setattr(sv, "guarded_async_client", lambda **kw: _Client())
    monkeypatch.setattr(sv.settings, "APIFY_TOKEN", "sekret")
    url = "https://api.apify.com/v2/key-value-stores/s/records/v"
    assert asyncio.run(sv.download_video(url)) is None
    assert seen["url"] == url and "sekret" not in seen["url"]
    assert seen["headers"]["Authorization"] == "Bearer sekret"
