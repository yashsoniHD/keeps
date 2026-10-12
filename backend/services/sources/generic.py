"""Generic webpages (recipes, articles, blogs, travel guides): JSON-LD first, then readable text.

Most recipe sites embed a complete schema.org/Recipe (exact ingredient quantities, times,
steps) — far more precise than scraped prose, so it is extracted and passed to Gemini
verbatim as ground truth. Articles often embed schema.org/Article with author/date.
"""
import json
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from models.note import ContentBundle
from services.net_guard import guarded_async_client

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                   "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"),
    "Accept-Language": "en-IN,en;q=0.9",
}

_INTERESTING_LD_TYPES = ("Recipe", "Article", "NewsArticle", "BlogPosting", "HowTo",
                         "Product", "Event", "TouristAttraction", "FAQPage")


def matches(url: str) -> bool:
    return True  # catch-all; registered last in the resolver


def _walk_json_ld(soup: BeautifulSoup) -> dict | None:
    """Returns the most interesting JSON-LD block on the page (Recipe > Article > …)."""
    found: dict[str, dict] = {}
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            t = item.get("@type")
            t = t[0] if isinstance(t, list) and t else t
            if t in _INTERESTING_LD_TYPES and t not in found:
                found[t] = item
    for preferred in _INTERESTING_LD_TYPES:
        if preferred in found:
            return found[preferred]
    return None


async def acquire(url: str) -> ContentBundle:
    async with guarded_async_client(timeout=20.0, follow_redirects=True) as client:
        resp = await client.get(url, headers=_HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    json_ld = _walk_json_ld(soup)

    title = "Untitled"
    if t := soup.find("meta", property="og:title"):
        title = t.get("content") or title
    elif soup.title and soup.title.string:
        title = soup.title.string.strip()
    elif h1 := soup.find("h1"):
        title = h1.get_text(strip=True)

    thumbnail = None
    for prop in ("og:image", "twitter:image"):
        if tag := (soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})):
            thumbnail = tag.get("content")
            if thumbnail:  # a relative og:image would otherwise load against keeps.web.app
                thumbnail = urljoin(str(resp.url), thumbnail)
            break

    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]):
        tag.decompose()

    content_area = soup.find("article") or soup.find("main") or soup.body
    paragraphs = content_area.find_all(["p", "h1", "h2", "h3", "h4", "li"]) if content_area else []
    text = "\n\n".join(
        p.get_text(" ", strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 15
    )[:28000]

    first_image = None
    if not thumbnail and content_area:
        for img in content_area.find_all("img"):
            src = img.get("src", "")
            if src.startswith("http") and not src.endswith(".svg"):
                first_image = src
                break

    images = [i for i in [thumbnail, first_image] if i]
    metadata = {
        "title": title,
        "platform": "web",
        "json_ld_type": (json_ld or {}).get("@type"),
    }
    return ContentBundle(
        kind="structured" if json_ld else "text",
        text=text or title,
        structured=json_ld,
        images=images,
        metadata=metadata,
        strategy="web_json_ld" if json_ld else "web_scrape",
    )
