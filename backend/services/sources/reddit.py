"""Reddit: public JSON API first, RSS fallback.

Every public post is theoretically available as JSON by appending `.json`, but Reddit
403-blocks that endpoint for many non-browser clients and datacenter IPs (measured during
Phase 0). The post's `.rss` feed, however, passes — and contains the post body plus its
comments (HTML-encoded). Strategy: try `.json`, fall back to `.rss`.

Production hardening (Stage B option): the free OAuth API (client-credentials) removes the
block entirely.
"""
import asyncio

import defusedxml.ElementTree as ET

import httpx
from bs4 import BeautifulSoup

from models.note import ContentBundle

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
_ATOM = "{http://www.w3.org/2005/Atom}"


def matches(url: str) -> bool:
    u = url.lower()
    return "reddit.com/r/" in u or "redd.it" in u


def _comment_lines_json(children: list, limit: int = 12) -> list[str]:
    lines: list[str] = []
    for child in children:
        if child.get("kind") != "t1" or len(lines) >= limit:
            continue
        d = child.get("data", {})
        body = (d.get("body") or "").strip()
        if not body or body in ("[deleted]", "[removed]"):
            continue
        lines.append(f"[{d.get('score', 0)} pts] u/{d.get('author', 'unknown')}: {body[:1200]}")
    return lines


def _bundle(title: str, text: str, author: str, images: list[str], strategy: str) -> ContentBundle:
    return ContentBundle(
        kind="text",
        text=text[:28000],
        images=images,
        metadata={"title": title, "author": author, "platform": "reddit"},
        strategy=strategy,
    )


async def _try_json(client: httpx.AsyncClient, url: str) -> ContentBundle | None:
    json_url = url.split("?")[0].rstrip("/") + ".json"
    resp = await client.get(json_url, params={"limit": 30, "raw_json": 1})
    if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("application/json"):
        return None
    payload = resp.json()
    post = payload[0]["data"]["children"][0]["data"]
    comments = _comment_lines_json(payload[1]["data"]["children"]) if len(payload) > 1 else []

    parts = [f"Title: {post.get('title', '')}"]
    if post.get("selftext"):
        parts.append(post["selftext"][:12000])
    elif post.get("url_overridden_by_dest"):
        parts.append(f"Linked URL: {post['url_overridden_by_dest']}")
    if comments:
        parts.append("Top comments:\n" + "\n\n".join(comments))

    preview_img = None
    try:
        preview_img = post["preview"]["images"][0]["source"]["url"].replace("&amp;", "&")
    except (KeyError, IndexError):
        pass
    return _bundle(post.get("title", "Untitled"), "\n\n".join(parts),
                   f"u/{post.get('author', 'unknown')}",
                   [i for i in [preview_img] if i], "reddit_json")


async def _try_rss(client: httpx.AsyncClient, url: str) -> ContentBundle | None:
    rss_url = url.split("?")[0].rstrip("/") + ".rss"
    resp = await client.get(rss_url)
    if resp.status_code != 200:
        return None
    root = ET.fromstring(resp.text)
    entries = root.findall(f"{_ATOM}entry")
    if not entries:
        return None

    def entry_text(e) -> tuple[str, str]:
        title = (e.findtext(f"{_ATOM}title") or "").strip()
        html = e.findtext(f"{_ATOM}content") or ""
        text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
        text = text.replace("submitted by", "").split("[link]")[0].strip()
        author = (e.findtext(f"{_ATOM}author/{_ATOM}name") or "").strip()
        return title, f"{author}: {text}" if author else text

    post_title, post_body = entry_text(entries[0])
    comments = [entry_text(e)[1][:1200] for e in entries[1:13]]

    parts = [f"Title: {post_title}", post_body]
    if comments:
        parts.append("Comments:\n" + "\n\n".join(c for c in comments if c))
    return _bundle(post_title, "\n\n".join(parts), "", [], "reddit_rss")


async def acquire(url: str) -> ContentBundle:
    # Reddit intermittently 403s burst traffic (measured: the same request alternates
    # between 200 and 403 within seconds) — retry with backoff before giving up.
    headers = {"User-Agent": _UA, "Accept": "application/json"}
    last_error: Exception | None = None
    for delay in (0, 2, 5):
        if delay:
            await asyncio.sleep(delay)
        try:
            # RSS first: .json 403s on many networks AND a failed .json request trips
            # Reddit's bot detection for the request that follows it (measured).
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers) as client:
                bundle = await _try_rss(client, url)
                if bundle is None:
                    bundle = await _try_json(client, url)
            if bundle is not None:
                return bundle
        except Exception as e:
            last_error = e
    raise RuntimeError(f"Reddit blocked both .json and .rss endpoints (last error: {last_error})")
