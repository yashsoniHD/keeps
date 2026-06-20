"""Tests for the google_share source handler and URL whitespace sanitization."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.sources.google_share import matches, acquire
from models.note import IngestRequest


# --- matches() ---

@pytest.mark.parametrize("url,expected", [
    ("https://share.google/z5Q7WvGPzDy5v0jc1", True),
    ("https://share.google/abc123", True),
    ("http://share.google/xyz", True),
    ("https://sub.share.google/foo", True),
    ("https://www.google.com/search?q=test", False),
    ("https://youtube.com/watch?v=abc", False),
    ("https://maps.google.com/maps?q=paris", False),
])
def test_matches(url, expected):
    assert matches(url) is expected


# --- acquire() ---

def _mock_response(final_url: str, status_code: int = 200):
    resp = MagicMock()
    resp.url = MagicMock()
    resp.url.__str__ = lambda _: final_url
    resp.status_code = status_code
    return resp


@pytest.mark.asyncio
async def test_acquire_knowledge_panel():
    final = ("https://www.google.com/search?kgmid=/m/0ff4w&q=Miller%27s+Crossing"
             "&shem=dlvsc&source=sh/x/kp/osrp")
    mock_resp = _mock_response(final)
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.sources.google_share.guarded_async_client", return_value=mock_client):
        bundle = await acquire("https://share.google/z5Q7WvGPzDy5v0jc1")

    assert bundle.strategy == "google_knowledge_panel"
    assert "Miller's Crossing" in bundle.text
    assert bundle.metadata["title"] == "Miller's Crossing"


@pytest.mark.asyncio
async def test_acquire_maps():
    final = "https://maps.google.com/maps?q=Eiffel+Tower&ll=48.858,2.294"
    mock_resp = _mock_response(final)
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.sources.google_share.guarded_async_client", return_value=mock_client):
        bundle = await acquire("https://share.google/maplinkxyz")

    assert bundle.strategy == "google_maps_share"
    assert "Eiffel Tower" in bundle.text


@pytest.mark.asyncio
async def test_acquire_no_entity_falls_back_to_url():
    final = "https://www.google.com/search?source=hp"
    mock_resp = _mock_response(final)
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("services.sources.google_share.guarded_async_client", return_value=mock_client):
        bundle = await acquire("https://share.google/unknown")

    assert bundle.strategy == "google_share"
    assert bundle.text  # something is always returned


# --- IngestRequest URL whitespace sanitization ---

@pytest.mark.parametrize("raw,expected", [
    # Leading/trailing whitespace
    ("  https://example.com  ", "https://example.com"),
    ("https://example.com\n", "https://example.com"),
    # URL embedded in text (iOS share sheet style)
    ("Check this: https://share.google/abc via Safari", "https://share.google/abc"),
    ("Miller's Crossing https://share.google/abc", "https://share.google/abc"),
    # Clean URL — must pass through unmodified
    ("https://share.google/z5Q7WvGPzDy5v0jc1", "https://share.google/z5Q7WvGPzDy5v0jc1"),
    # Non-breaking space (iOS clipboard quirk)
    ("\xa0https://example.com\xa0", "https://example.com"),
])
def test_ingest_request_url_cleaning(raw, expected):
    req = IngestRequest(url=raw)
    assert req.url == expected
