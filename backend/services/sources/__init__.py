"""Source-aware content resolver.

Maps a URL to the acquisition strategy best suited to it. Every strategy module exposes:
    matches(url: str) -> bool
    acquire(url: str) -> ContentBundle   (async)

Adding a new source (Pinterest, X, …) = one new module registered here.
"""
import logging
from urllib.parse import urljoin, urlparse

from models.note import ContentBundle
from services.net_guard import BlockedURLError, assert_public_url_async, guarded_async_client
from services.url_utils import canonical_url
from services.sources import youtube, social_video, reddit, product, twitter, google_share, generic

log = logging.getLogger("clipnote.sources")

# Ordered: first match wins. `generic` matches everything and must stay last.
_STRATEGIES = [youtube, social_video, reddit, product, twitter, google_share, generic]


def resolve(url: str):
    """Returns the strategy module for this URL."""
    for strategy in _STRATEGIES:
        if strategy.matches(url):
            return strategy
    return generic


async def _resolve_share(url: str) -> str | None:
    """Instagram/Facebook `/share/...` links are redirects to the real post. One GET, no
    redirect following, read `Location` (a login-wall redirect is ignored). None = leave as is."""
    try:
        async with guarded_async_client(timeout=8.0, follow_redirects=False) as client:
            resp = await client.get(url, headers={"User-Agent": "facebookexternalhit/1.1"})
        loc = resp.headers.get("location")
        if resp.status_code not in (301, 302, 303, 307, 308) or not loc:
            return None
        target = canonical_url(urljoin(url, loc))
        if "/login" in target or "/accounts/" in target or "/share/" in target:
            return None
        await assert_public_url_async(target)
        return target
    except BlockedURLError:
        raise
    except Exception as e:
        log.info("share link resolution failed for %s: %s", url, str(e)[:120])
        return None


async def acquire(url: str) -> ContentBundle:
    """Resolve and run the strategy; on failure fall back to the generic scraper
    so a note is still produced from whatever metadata is reachable."""
    # SSRF gate: refuse URLs that resolve to private/internal addresses before any
    # strategy touches them. BlockedURLError is permanent — no fallback, no stub note.
    await assert_public_url_async(url)
    canonical = None
    if "/share/" in urlparse(url).path and social_video.matches(url):
        if canonical := await _resolve_share(url):
            url = canonical
    bundle = await _acquire(url)
    if canonical:
        bundle.metadata["canonical_url"] = canonical
    return bundle


async def _acquire(url: str) -> ContentBundle:
    strategy = resolve(url)
    try:
        return await strategy.acquire(url)
    except BlockedURLError:
        raise
    except Exception as e:
        log.warning("strategy %s failed: %s: %s", strategy.__name__, type(e).__name__, e,
                    extra={"url": url, "strategy": strategy.__name__})
        if strategy is not generic:
            try:
                return await generic.acquire(url)
            except BlockedURLError:
                raise
            except Exception as e2:
                log.warning("generic fallback also failed: %s: %s", type(e2).__name__, e2,
                            extra={"url": url})
        # Last resort: metadata-only bundle so the pipeline can still emit a stub note.
        host = urlparse(url).netloc.replace("www.", "")
        return ContentBundle(
            kind="metadata_only",
            text=f"URL: {url} (content could not be retrieved)",
            metadata={"title": host, "platform": host},
            strategy="unreachable",
        )
