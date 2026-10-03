"""services.dispatch: self-POST to the worker with the shared secret."""
import httpx
import pytest

from config import settings
from services import dispatch


@pytest.fixture(autouse=True)
def cfg(monkeypatch):
    monkeypatch.setattr(settings, "WORKER_URL", "https://app.example", raising=False)
    monkeypatch.setattr(settings, "WORKER_SECRET", "s3cret", raising=False)


def _patch_post(monkeypatch, *, status=200, exc=None):
    calls = []

    def fake_post(url, headers=None, timeout=None, **kw):
        calls.append((url, headers, timeout))
        if exc:
            raise exc
        return httpx.Response(status, request=httpx.Request("POST", url))

    monkeypatch.setattr(dispatch.httpx, "post", fake_post)
    return calls


def test_posts_url_and_secret_header(monkeypatch):
    calls = _patch_post(monkeypatch)
    dispatch.enqueue_process_job("j1")
    url, headers, timeout = calls[0]
    assert url == "https://app.example/api/process/j1"
    assert headers == {"X-Worker-Secret": "s3cret"}
    assert timeout.read == 1.5


def test_path_selects_agent_worker(monkeypatch):
    calls = _patch_post(monkeypatch)
    dispatch.enqueue_process_job("j1", "/api/process-agent")
    assert calls[0][0] == "https://app.example/api/process-agent/j1"


def test_read_timeout_means_accepted(monkeypatch):
    _patch_post(monkeypatch, exc=httpx.ReadTimeout("mid-run"))
    dispatch.enqueue_process_job("j1")  # no raise


def test_409_is_fine(monkeypatch):
    _patch_post(monkeypatch, status=409)
    dispatch.enqueue_process_job("j1")


def test_403_raises(monkeypatch):
    _patch_post(monkeypatch, status=403)
    with pytest.raises(RuntimeError):
        dispatch.enqueue_process_job("j1")


def test_connect_error_raises(monkeypatch):
    _patch_post(monkeypatch, exc=httpx.ConnectError("refused"))
    with pytest.raises(httpx.ConnectError):
        dispatch.enqueue_process_job("j1")
