"""services.worker_auth: fail closed, header match, cron bearer only on the sweep route."""
import pytest
from fastapi import HTTPException

from config import settings
from services.worker_auth import verify_worker_secret


class Req:
    def __init__(self, **headers):
        self.headers = {k.replace("_", "-"): v for k, v in headers.items()}


@pytest.fixture(autouse=True)
def cfg(monkeypatch):
    monkeypatch.setattr(settings, "WORKER_SECRET", "s3cret", raising=False)
    monkeypatch.setattr(settings, "CRON_SECRET", "cron-s3cret", raising=False)


def test_valid_header_accepted():
    verify_worker_secret(Req(x_worker_secret="s3cret"))


@pytest.mark.parametrize("hdrs", [{}, {"x_worker_secret": "nope"}, {"x_worker_secret": ""}])
def test_bad_or_missing_header_rejected(hdrs):
    with pytest.raises(HTTPException) as e:
        verify_worker_secret(Req(**hdrs))
    assert e.value.status_code == 403


def test_empty_secret_fails_closed(monkeypatch):
    monkeypatch.setattr(settings, "WORKER_SECRET", "", raising=False)
    with pytest.raises(HTTPException) as e:
        verify_worker_secret(Req(x_worker_secret=""))
    assert e.value.status_code == 403


def test_empty_cron_secret_fails_closed(monkeypatch):
    monkeypatch.setattr(settings, "CRON_SECRET", "", raising=False)
    with pytest.raises(HTTPException):
        verify_worker_secret(Req(authorization="Bearer "), allow_cron=True)


def test_cron_bearer_only_with_allow_cron():
    req = Req(authorization="Bearer cron-s3cret")
    verify_worker_secret(req, allow_cron=True)
    with pytest.raises(HTTPException):
        verify_worker_secret(req)


def test_worker_secret_not_accepted_as_bearer():
    with pytest.raises(HTTPException):
        verify_worker_secret(Req(authorization="Bearer s3cret"), allow_cron=True)


def test_non_ascii_is_403_not_500():
    with pytest.raises(HTTPException) as e:
        verify_worker_secret(Req(x_worker_secret="sécret"))
    assert e.value.status_code == 403
