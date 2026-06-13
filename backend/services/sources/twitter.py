"""X / Twitter: public syndication API (no auth).

Tweet text is rendered client-side, so a server-side scrape of an x.com URL sees only og:meta
tags — never the tweet body. The syndication CDN endpoint Twitter's own embed widget uses
(`cdn.syndication.twimg.com/tweet-result`, the same one Vercel's react-tweet calls) returns the
full tweet as JSON with no authentication: text, author, media, and any quoted tweet.

Scope: text + media thumbnail only (no video download). The endpoint returns just the single
linked tweet, not an entire thread — quoted-tweet text is folded in for context.
"""
import asyncio
import math
import re

from models.note import ContentBundle
from services.net_guard import guarded_async_client

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
_DOMAINS = ("twitter.com", "x.com", "mobile.twitter.com")
_ID_RE = re.compile(r"/status(?:es)?/(\d+)")
_SYNDICATION = "https://cdn.syndication.twimg.com/tweet-result"


def matches(url: str) -> bool:
    u = url.lower()
    return any(d in u for d in _DOMAINS)


def _token(tid: int) -> str:
    """react-tweet's required `token` query param: ((id/1e15)*pi) in base36, zeros/dots stripped."""
    n = (tid / 1e15) * math.pi
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    i = int(n)
    frac = n - i
    s = "" if i else "0"
    while i:
        s = digits[i % 36] + s
        i //= 36
    f = ""
    for _ in range(12):
        frac *= 36
        d = int(frac)
        f += digits[d]
        frac -= d
    return re.sub(r"(0+|\.)", "", s + "." + f)


def _tweet_id(url: str) -> str | None:
    m = _ID_RE.search(url)
    return m.group(1) if m else None


async def _fetch(tweet_id: str) -> dict:
    """GET the syndication JSON for a tweet id. Raises on non-200."""
    params = {"id": tweet_id, "token": _token(int(tweet_id)), "lang": "en"}
    async with guarded_async_client(timeout=15.0, follow_redirects=True,
                                    headers={"User-Agent": _UA}) as client:
        resp = await client.get(_SYNDICATION, params=params)
    resp.raise_for_status()
    return resp.json()


def _media_urls(tweet: dict) -> list[str]:
    """Poster image for every media item (photo → image, video/gif → its still)."""
    out = []
    for m in tweet.get("mediaDetails") or []:
        u = m.get("media_url_https")
        if u:
            out.append(u)
    return out


def _bundle(tweet: dict) -> ContentBundle:
    user = tweet.get("user") or {}
    name = user.get("name") or ""
    handle = user.get("screen_name") or ""
    text = (tweet.get("text") or "").strip()

    quoted = tweet.get("quoted_tweet") or {}
    if quoted.get("text"):
        q_user = (quoted.get("user") or {}).get("screen_name") or "unknown"
        text = f"{text}\n\nQuoted @{q_user}: {quoted['text'].strip()}"

    images = _media_urls(tweet)
    if not text and not images:
        raise RuntimeError("tweet has no text or media (deleted/protected?)")

    title = (text[:80] + "…") if len(text) > 80 else (text or f"Tweet by {name}".strip())
    return ContentBundle(
        kind="text",
        text=text[:28000],
        images=images,
        metadata={
            "title": title,
            "author": f"@{handle}" if handle else name,
            "platform": "x",
        },
        strategy="twitter_syndication",
    )


async def acquire(url: str) -> ContentBundle:
    tweet_id = _tweet_id(url)
    if not tweet_id:
        # Not a tweet URL (profile/home/search) — let the resolver fall back to generic.
        raise RuntimeError(f"no tweet id in URL: {url}")

    last_error: Exception | None = None
    for delay in (0, 2):
        if delay:
            await asyncio.sleep(delay)
        try:
            return _bundle(await _fetch(tweet_id))
        except Exception as e:
            last_error = e
    raise RuntimeError(f"syndication fetch failed for tweet {tweet_id}: {last_error}")
