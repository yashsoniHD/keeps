"""SSRF guard for outbound fetches of user-supplied URLs.

Every scraper fetch goes through `guarded_async_client()`, whose request hook
re-validates each hop (redirects included) so a public URL can't 302 into the
GCP metadata server (169.254.169.254), localhost, or RFC-1918 space.

Known limitation (accepted for MVP): the DNS check and httpx's own resolution
are separate lookups, so a malicious resolver flipping records between them
(DNS rebinding) could slip through. Closing that requires pinning the resolved
IP into the connection pool; revisit if the app ever holds privileged intranet
access beyond the metadata server.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

import httpx


class BlockedURLError(ValueError):
    """URL points at a private/internal address — refusing to fetch."""


def _is_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def assert_public_url(url: str) -> None:
    """Raises BlockedURLError unless `url` is http(s) and resolves only to public IPs.

    Unresolvable hostnames pass — the actual fetch fails on its own, and treating
    transient DNS errors as "blocked" would reject legitimate saves.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise BlockedURLError(f"Unsupported URL scheme: {parsed.scheme!r}")
    host = parsed.hostname
    if not host:
        raise BlockedURLError("URL has no hostname")

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public_ip(literal):
            raise BlockedURLError(f"Blocked non-public address: {host}")
        return

    try:
        infos = socket.getaddrinfo(host, parsed.port or 0, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not _is_public_ip(ip):
            raise BlockedURLError(f"Blocked non-public address: {host} -> {ip}")


async def assert_public_url_async(url: str) -> None:
    """DNS resolution is blocking — run the check off the event loop."""
    await asyncio.to_thread(assert_public_url, url)


async def _guard_request(request: httpx.Request) -> None:
    await assert_public_url_async(str(request.url))


def guarded_async_client(**kwargs) -> httpx.AsyncClient:
    """httpx.AsyncClient that validates every request URL, redirect hops included.

    Use for any fetch whose URL derives from user input; fixed-domain calls
    (r.jina.ai, api.firecrawl.dev, oEmbed) don't need it.
    """
    hooks = kwargs.pop("event_hooks", {})
    hooks.setdefault("request", []).insert(0, _guard_request)
    return httpx.AsyncClient(event_hooks=hooks, **kwargs)
