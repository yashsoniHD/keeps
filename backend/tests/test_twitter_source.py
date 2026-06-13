"""twitter.acquire: syndication JSON → text bundle with media + quoted-tweet context.

The network call (`_fetch`) is stubbed; these tests cover URL matching, parsing, and the
no-tweet-id path that hands off to the generic fallback."""
import pytest

import services.sources.twitter as tw

SAMPLE = {
    "text": "Saturn's rings will briefly vanish in 2025 https://t.co/abc",
    "user": {"name": "Jane Doe", "screen_name": "jane"},
    "mediaDetails": [
        {"type": "photo", "media_url_https": "https://pbs.twimg.com/media/pic.jpg"},
    ],
    "quoted_tweet": {"text": "original take", "user": {"screen_name": "src"}},
}


def test_matches():
    assert tw.matches("https://x.com/jane/status/123")
    assert tw.matches("https://twitter.com/jane/status/123")
    assert tw.matches("https://mobile.twitter.com/jane/status/123")
    assert not tw.matches("https://youtube.com/watch?v=abc")
    assert not tw.matches("https://example.com/x")


async def test_acquire_parses_text_media_and_quote(monkeypatch):
    async def fake_fetch(tweet_id):
        assert tweet_id == "123"
        return SAMPLE

    monkeypatch.setattr(tw, "_fetch", fake_fetch)

    bundle = await tw.acquire("https://x.com/jane/status/123")
    assert bundle.kind == "text"
    assert "Saturn's rings" in bundle.text
    assert "Quoted @src: original take" in bundle.text  # quoted-tweet context folded in
    assert bundle.images == ["https://pbs.twimg.com/media/pic.jpg"]
    assert bundle.metadata["author"] == "@jane"
    assert bundle.metadata["platform"] == "x"
    assert bundle.strategy == "twitter_syndication"


async def test_acquire_without_tweet_id_raises(monkeypatch):
    """A profile/home URL has no /status/<id> → acquire raises so the resolver falls back
    to the generic scraper rather than 500ing."""
    monkeypatch.setattr(tw, "_fetch", lambda *_: pytest.fail("_fetch should not be called"))
    with pytest.raises(RuntimeError):
        await tw.acquire("https://x.com/jane")


def test_token_is_deterministic_and_clean():
    """Token strips zeros/dots and is stable for a given id (react-tweet algorithm)."""
    t = tw._token(1349129669258448897)
    assert t and "." not in t and "0" not in t
    assert t == tw._token(1349129669258448897)
