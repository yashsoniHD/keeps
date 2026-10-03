import pytest

from models.note import IngestRequest
from services.url_utils import canonical_url


@pytest.mark.parametrize("raw,want", [
    ("https://example.com/a?utm_source=x&id=7&fbclid=Z&gclid=Q", "https://example.com/a?id=7"),
    ("https://www.instagram.com/reel/ABC/?igsh=xyz&igshid=1&mibextid=w",
     "https://www.instagram.com/reel/ABC/"),
    ("https://www.instagram.com/reels/ABC/", "https://www.instagram.com/reel/ABC/"),
    ("https://www.instagram.com/someuser/reel/ABC/?igsh=1", "https://www.instagram.com/reel/ABC/"),
    ("https://www.instagram.com/p/ABC/?img_index=2", "https://www.instagram.com/p/ABC/?img_index=2"),
    ("https://www.tiktok.com/@u/video/123?_r=1&_t=abc&is_from_webapp=1&u_code=z",
     "https://www.tiktok.com/@u/video/123"),
    ("https://youtu.be/dQw4w9WgXcQ?si=abc", "https://youtu.be/dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&t=30",
     "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"),
    # `si` only on YouTube hosts
    ("https://shop.example.com/x?si=keepme", "https://shop.example.com/x?si=keepme"),
    ("https://example.com/a?flag&x=1", "https://example.com/a?flag&x=1"),   # untouched: verbatim
    ("https://example.com/a?q=a%20b", "https://example.com/a?q=a%20b"),
    ("https://notyoutube.com/w?si=keep&utm_x=1", "https://notyoutube.com/w?si=keep"),
    ("https://music.youtube.com/watch?v=1&si=a", "https://music.youtube.com/watch?v=1"),
    ("not a url", "not a url"),
    ("ftp://x.com/a?utm_x=1", "ftp://x.com/a?utm_x=1"),
])
def test_canonical_url(raw, want):
    assert canonical_url(raw) == want


def test_canonical_keeps_reel_substring_for_apify_routing():
    from services.apify import _url_kind
    assert _url_kind(canonical_url("https://www.instagram.com/reels/XYZ/")) == "instagram_reel"


def test_ingest_request_canonicalizes():
    assert IngestRequest(url="https://youtu.be/abcdefghijk?si=1\n").url == "https://youtu.be/abcdefghijk"
