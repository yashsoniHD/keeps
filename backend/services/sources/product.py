"""Product pages (Amazon, Flipkart, Myntra, generic shops): tiered acquisition.

Tier 1: direct fetch with realistic mobile headers; parse JSON-LD schema.org/Product if
        present, else known per-site selectors (Amazon title/price/feature bullets).
Tier 2: Firecrawl API (if FIRECRAWL_API_KEY set) for bot-blocked pages.
Tier 3: og:meta only.

Phase 0 measures which tier Amazon.in actually requires.
"""
import asyncio
import json
import re

import httpx
from bs4 import BeautifulSoup

from config import settings
from models.note import ContentBundle
from services.net_guard import guarded_async_client

import logging
log = logging.getLogger("clipnote.sources")

_PRODUCT_DOMAINS = (
    "amazon.", "amzn.", "flipkart.com", "myntra.com", "ajio.com",
    "nykaa.com", "nykaaman.com", "croma.com", "reliancedigital.in", "bigbasket.com",
)

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                   "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}


def matches(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in _PRODUCT_DOMAINS)


def _extract_json_ld(soup: BeautifulSoup) -> dict | None:
    """Returns the first schema.org/Product JSON-LD block, if any."""
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        candidates = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for item in candidates:
            if isinstance(item, dict) and item.get("@type") in ("Product", ["Product"]):
                return item
    return None


def _amazon_fields(soup: BeautifulSoup, html: str) -> dict:
    """Best-effort extraction for Amazon product pages.

    Mobile and desktop layouts use different selectors (mobile has no #productTitle /
    #acrPopover / #landingImage), so each field tries selectors first, then regex over
    the embedded JSON Amazon ships in the page (measured on amazon.in, June 2026).
    """
    fields: dict = {}

    title_el = soup.select_one("#productTitle") or soup.select_one("#title") or soup.find("h1")
    if title_el and title_el.get_text(strip=True):
        fields["title"] = title_el.get_text(" ", strip=True)

    price_el = soup.select_one(".priceToPay") or soup.select_one(".a-price .a-offscreen")
    price = price_el.get_text(" ", strip=True) if price_el else ""
    if not price.strip("₹$ ").strip():
        m = re.search(r'"displayPrice"\s*:\s*"([^"]+)"', html)
        price = m.group(1) if m else ""
    if price:
        fields["price"] = price.replace("₹ ", "₹")

    bullets = [li.get_text(" ", strip=True) for li in soup.select("#feature-bullets li")]
    if bullets:
        fields["feature_bullets"] = bullets[:12]

    if r := soup.select_one("#acrPopover"):
        fields["rating"] = (r.get("title") or "").strip()
    elif m := re.search(r"([\d.]+) out of 5 stars", html):
        fields["rating"] = f"{m.group(1)} out of 5"

    if img := soup.select_one("#landingImage"):
        fields["image"] = img.get("src")
    elif m := re.search(r'"(?:hiRes|large)"\s*:\s*"(https://[^"]+)"', html):
        fields["image"] = m.group(1)

    rows = {}
    for tr in soup.select("#productDetails_techSpec_section_1 tr, #productOverview_feature_div tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
        if len(cells) == 2:
            rows[cells[0]] = cells[1]
    if rows:
        fields["specs"] = rows
    return fields


def _og_meta(soup: BeautifulSoup) -> dict:
    meta = {}
    for prop in ("og:title", "og:description", "og:image"):
        if tag := (soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})):
            meta[prop.split(":")[1]] = tag.get("content")
    return meta


def _looks_blocked(status: int, html: str) -> bool:
    if status in (403, 503, 429):
        return True
    low = html[:6000].lower()
    # Amazon's datacenter-IP interstitial is an HTTP 200 with a near-empty body whose only
    # CTA is "Continue shopping" (sometimes a validateCaptcha form) — not the product page.
    return any(
        marker in low
        for marker in (
            "captcha", "robot check", "automated access",
            "validatecaptcha", "continue shopping",
            "type the characters you see",
        )
    )


def _strip_nav_markdown(md: str) -> str:
    """Reader output on shop pages is dominated by nav/footer link lists. Drop lines
    that are mostly markdown links or images; keep prose, prices, specs.
    (Measured: 426 KB Nykaa page → 12 KB of pure product content.)"""
    out = []
    for ln in md.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith(("[![", "![")):
            continue
        links = s.count("](")
        if links and len(re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)) < 25 * links:
            continue
        out.append(s)
    return "\n".join(out)


async def _jina_reader(url: str) -> str | None:
    """Tier 2a: r.jina.ai renders JS and returns markdown — free (rate-limited) without
    a key. Catches SPA shops (Nykaa etc.) that serve an empty JS shell to datacenter IPs."""
    headers = {"X-Return-Format": "markdown"}
    if settings.JINA_API_KEY:
        headers["Authorization"] = f"Bearer {settings.JINA_API_KEY}"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(f"https://r.jina.ai/{url}", headers=headers)
        if resp.status_code == 200 and len(resp.text) > 500:
            # Jina forwards CAPTCHA interstitials as "successful" markdown — reject them.
            if "captcha" in resp.text[:1500].lower():
                return None
            return _strip_nav_markdown(resp.text)
    except httpx.HTTPError as e:
        log.warning("jina reader failed: %s", e, extra={"url": url})
    return None


async def _firecrawl(url: str) -> str | None:
    """Tier 2: Firecrawl scrape → markdown. Requires FIRECRAWL_API_KEY."""
    if not settings.FIRECRAWL_API_KEY:
        return None
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.firecrawl.dev/v1/scrape",
            headers={"Authorization": f"Bearer {settings.FIRECRAWL_API_KEY}"},
            json={"url": url, "formats": ["markdown"]},
        )
    if resp.status_code != 200:
        return None
    return (resp.json().get("data") or {}).get("markdown")


async def acquire(url: str) -> ContentBundle:
    html, status, final_url = "", 0, url
    try:
        async with guarded_async_client(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=_HEADERS)
            html, status = resp.text, resp.status_code
            # Short links (amzn.in/d/…) expand via redirect even when the destination
            # serves a bot-block page — the canonical URL is gold for the search tier.
            final_url = str(resp.url)
    except httpx.HTTPError as e:
        log.warning("direct fetch error: %s", e, extra={"url": url})

    blocked = not html or _looks_blocked(status, html)

    soup = BeautifulSoup(html, "html.parser") if html else BeautifulSoup("", "html.parser")
    json_ld = _extract_json_ld(soup)
    og = _og_meta(soup)
    site_fields = _amazon_fields(soup, html) if "amazon" in url.lower() or "amzn." in url.lower() else {}

    # Readable text body (descriptions, reviews snippets) for context.
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    body_text = " ".join(
        p.get_text(" ", strip=True) for p in soup.find_all(["p", "li", "h1", "h2", "span"])
        if len(p.get_text(strip=True)) > 25
    )[:15000]

    title = site_fields.get("title") or (json_ld or {}).get("name") or og.get("title") or "Untitled product"
    images = [i for i in [site_fields.get("image"), og.get("image")] if i]
    if json_ld and json_ld.get("image"):
        img = json_ld["image"]
        images.extend(img if isinstance(img, list) else [img])

    text_parts = []
    if site_fields:
        text_parts.append("Extracted product fields:\n" + json.dumps(site_fields, ensure_ascii=False, indent=1))
    if og.get("description"):
        text_parts.append(og["description"])
    if body_text:
        text_parts.append(body_text)

    # Escalate when the direct fetch was blocked OR merely thin (SPA shops serve a JS
    # shell with og:title but no price/specs/body — looks "ok" but extracts nothing).
    thin = not json_ld and not site_fields.get("price") and len(body_text) < 800
    if blocked or thin:
        md = (await _jina_reader(final_url)) or (await _firecrawl(final_url))
        if md:
            return ContentBundle(
                kind="text", text=md[:28000],
                images=images,
                metadata={"title": title if title != "Untitled product" else md.splitlines()[0][:120],
                          "platform": "product", "tier": "reader"},
                strategy="product_reader",
            )
        # Tier 2b: Amazon blocks every direct fetcher (datacenter IPs, Jina, Gemini's
        # url_context) — but its listings are fully indexed, so recover the facts via
        # Google Search grounding on the expanded canonical URL.
        from services.gemini import gemini_service
        hint = title if title != "Untitled product" else ""
        grounded = await gemini_service.search_grounded_page(final_url, hint)
        if grounded:
            return ContentBundle(
                kind="text", text=grounded[:28000],
                images=images,
                metadata={"title": title, "platform": "product", "tier": "search_grounded",
                          "canonical_url": final_url},
                strategy="product_search_grounded",
            )

    if not json_ld and not site_fields and not body_text:
        # Tier 3: og:meta only (or nothing).
        return ContentBundle(
            kind="metadata_only",
            text=og.get("description") or title,
            images=images,
            metadata={"title": title, "platform": "product", "tier": "og_only", "blocked": blocked},
            strategy="product_og_only",
        )

    return ContentBundle(
        kind="structured" if json_ld else "text",
        text="\n\n".join(text_parts)[:28000] or None,
        structured=json_ld,
        images=images[:6],
        metadata={"title": title, "platform": "product",
                  "tier": "json_ld" if json_ld else "selectors"},
        strategy="product_direct",
    )
