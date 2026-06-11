"""Source-aware content resolver.

Maps a URL to the acquisition strategy best suited to it. Every strategy module exposes:
    matches(url: str) -> bool
    acquire(url: str) -> ContentBundle   (async)

Adding a new source (Pinterest, X, …) = one new module registered here.
"""
import logging
from urllib.parse import urlparse

from models.note import ContentBundle
from services.net_guard import BlockedURLError, assert_public_url_async
from services.sources import youtube, social_video, reddit, product, generic

log = logging.getLogger("clipnote.sources")

# Ordered: first match wins. `generic` matches everything and must stay last.
_STRATEGIES = [youtube, social_video, reddit, product, generic]


def resolve(url: str):
    """Returns the strategy module for this URL."""
    for strategy in _STRATEGIES:
        if strategy.matches(url):
            return strategy
    return generic


async def acquire(url: str) -> ContentBundle:
    """Resolve and run the strategy; on failure fall back to the generic scraper
    so a note is still produced from whatever metadata is reachable."""
    # SSRF gate: refuse URLs that resolve to private/internal addresses before any
    # strategy touches them. BlockedURLError is permanent — no fallback, no stub note.
    await assert_public_url_async(url)
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
