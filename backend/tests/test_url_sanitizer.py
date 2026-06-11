"""IngestRequest URL sanitizer: messy share-sheet/shortcut input must normalize cleanly."""
from models.note import IngestRequest


def test_plain_url_unchanged():
    assert IngestRequest(url="https://example.com/a?b=c").url == "https://example.com/a?b=c"


def test_strips_surrounding_whitespace_and_newlines():
    assert IngestRequest(url="\n  https://example.com/x \n").url == "https://example.com/x"


def test_takes_first_http_token_from_multiline():
    # iOS Shortcut "Get URLs" stringifies multiple matches joined by newlines.
    raw = "https://amazon.in/dp/B0ABC\nhttps://amazon.in/dp/B0ABC"
    assert IngestRequest(url=raw).url == "https://amazon.in/dp/B0ABC"


def test_ignores_leading_prose():
    raw = "Check this out! https://example.com/deal today only"
    assert IngestRequest(url=raw).url == "https://example.com/deal"


def test_non_url_text_passes_through_for_endpoint_rejection():
    # The router rejects anything not starting with http(s) with a 400.
    assert not IngestRequest(url="not a url at all").url.startswith("http")
