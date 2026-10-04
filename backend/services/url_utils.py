"""Pure URL canonicalisation: strip share/tracking params so the same post dedups and the
resolvers (`apify._url_kind` relies on a `/reel` substring) see one shape."""
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING = {"fbclid", "gclid", "igsh", "igshid", "mibextid", "stkn"}
# /reels/<code>, /<user>/reel/<code>  ->  /reel/<code>/
_IG_REEL = re.compile(r"^/(?:[^/]+/)?reels?/([\w-]+)/?$")


def _is_host(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def canonical_url(url: str) -> str:
    try:
        p = urlsplit(url)
    except ValueError:
        return url
    if p.scheme not in ("http", "https") or not p.netloc:
        return url
    host = (p.hostname or "").lower()
    path = p.path
    if _is_host(host, "tiktok.com"):
        query = ""  # every TikTok query param is share tracking; the video id is in the path
    else:
        yt = _is_host(host, "youtube.com") or host == "youtu.be"
        pairs = parse_qsl(p.query, keep_blank_values=True)
        keep = [(k, v) for k, v in pairs
                if not (k.startswith("utm_") or k in _TRACKING or (yt and k == "si"))]
        # Untouched query stays byte-for-byte (`?flag`, `%20`); only rebuild when stripping.
        query = p.query if len(keep) == len(pairs) else urlencode(keep)
    if _is_host(host, "instagram.com") and (m := _IG_REEL.match(path)):
        path = f"/reel/{m.group(1)}/"
    return urlunsplit((p.scheme, p.netloc, path, query, p.fragment))
