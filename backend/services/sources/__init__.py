"""Source-aware content resolver.

Maps a URL to the acquisition strategy best suited to it. Every strategy module exposes:
    matches(url: str) -> bool
    acquire(url: str) -> ContentBundle   (async)

Adding a new source (Pinterest, X, …) = one new module registered here.
"""
from urllib.parse import urlparse

from models.note import ContentBundle
from services.sources import youtube, social_video, reddit, product, generic

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
    strategy = resolve(url)
    try:
        return await strategy.acquire(url)
    except Exception as e:
        print(f"[sources] {strategy.__name__} failed for {url}: {e}")
        if strategy is not generic:
            try:
                return await generic.acquire(url)
            except Exception as e2:
                print(f"[sources] generic fallback also failed for {url}: {e2}")
        # Last resort: metadata-only bundle so the pipeline can still emit a stub note.
        host = urlparse(url).netloc.replace("www.", "")
        return ContentBundle(
            kind="metadata_only",
            text=f"URL: {url} (content could not be retrieved)",
            metadata={"title": host, "platform": host},
            strategy="unreachable",
        )
