"""Google share.google short links → Knowledge Panel / Maps / entity extraction.

share.google links are JS-rendered Google Search Knowledge Panels, Maps pins,
or other Google surfaces that yield nothing to a standard scraper. We follow the
redirect chain to discover the destination, extract the entity name / query from
URL parameters, and hand Gemini that rich hint so it can synthesise the note from
its training data instead of from scraped HTML.
"""
from urllib.parse import parse_qs, urlparse

from models.note import ContentBundle
from services.net_guard import guarded_async_client

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                   "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"),
    "Accept-Language": "en-IN,en;q=0.9",
}


def matches(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return host == "share.google" or host.endswith(".share.google")


async def acquire(url: str) -> ContentBundle:
    # Follow all redirects to discover the final destination (Knowledge Panel, Maps, etc.).
    async with guarded_async_client(timeout=10.0, follow_redirects=True) as client:
        resp = await client.get(url, headers=_HEADERS)

    final_url = str(resp.url)
    parsed = urlparse(final_url)
    qs = parse_qs(parsed.query)

    entity = (qs.get("q") or [""])[0].strip()
    kgmid = (qs.get("kgmid") or [""])[0].strip()

    is_maps = "maps.google" in final_url or "/maps/" in final_url
    is_knowledge_panel = bool(kgmid)

    if is_maps:
        platform = "Google Maps"
        strategy = "google_maps_share"
    elif is_knowledge_panel:
        platform = "Google Knowledge Panel"
        strategy = "google_knowledge_panel"
    else:
        platform = "Google"
        strategy = "google_share"

    title = entity or parsed.netloc

    if entity:
        # Give Gemini a clear signal: the entity name IS the content.
        # Gemini 2.5 has deep knowledge of films, places, people, etc., so this is
        # enough for a rich structured note — no scraping needed.
        text = f"{platform}: {entity}"
        if kgmid:
            text += f"\nKnowledge Graph ID: {kgmid}"
        text += f"\nDestination URL: {final_url}"
    else:
        text = f"Shared link from Google: {final_url}"

    return ContentBundle(
        kind="text",
        text=text,
        metadata={
            "title": title,
            "platform": platform.lower().replace(" ", "_"),
        },
        strategy=strategy,
    )
