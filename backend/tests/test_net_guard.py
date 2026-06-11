"""SSRF guard: the security boundary for every outbound fetch of a user URL."""
import pytest

from services.net_guard import BlockedURLError, assert_public_url


@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data/",          # GCP/AWS metadata
    "http://metadata.google.internal/computeMetadata/",  # resolves link-local (or not at all)
    "http://127.0.0.1:8080/api/process/x",
    "http://localhost/admin",
    "http://10.0.0.5/internal",
    "http://172.16.0.1/",
    "http://192.168.1.1/router",
    "http://[::1]/",
    "http://0.0.0.0/",
])
def test_blocks_private_and_internal(url, monkeypatch):
    # Pin hostname resolution so the test is deterministic offline: localhost-ish
    # names resolve to loopback, everything else to its literal/own IP.
    import socket
    real_getaddrinfo = socket.getaddrinfo

    def fake_getaddrinfo(host, *a, **k):
        if host in ("localhost", "metadata.google.internal"):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]
        return real_getaddrinfo(host, *a, **k)

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(BlockedURLError):
        assert_public_url(url)


@pytest.mark.parametrize("url", ["ftp://example.com/file", "file:///etc/passwd", "gopher://x"])
def test_blocks_non_http_schemes(url):
    with pytest.raises(BlockedURLError):
        assert_public_url(url)


def test_allows_public_ip_literal():
    assert_public_url("https://8.8.8.8/")


def test_allows_public_hostname(monkeypatch):
    import socket
    monkeypatch.setattr(
        socket, "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.183.78", 0))],
    )
    assert_public_url("https://example.com/page")


def test_blocks_hostname_resolving_private(monkeypatch):
    """DNS-level SSRF: a public-looking hostname whose A record is internal."""
    import socket
    monkeypatch.setattr(
        socket, "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 0))],
    )
    with pytest.raises(BlockedURLError):
        assert_public_url("https://innocent-looking.example.com/")


def test_unresolvable_hostname_passes(monkeypatch):
    """Transient DNS failures must not reject legitimate saves — the fetch fails on its own."""
    import socket

    def boom(*a, **k):
        raise socket.gaierror("NXDOMAIN")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    assert_public_url("https://does-not-exist.example/")
