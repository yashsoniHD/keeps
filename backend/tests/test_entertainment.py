"""Entertainment family matcher + structured-titles extraction schema."""
import pytest

from models.note import NoteExtraction
from services.gemini import TYPE_PROMPTS, is_entertainment


@pytest.mark.parametrize("slug", [
    "entertainment-recommendations", "movie", "films", "tv-shows", "anime",
    "best-series", "Movie Night", "netflix-picks",
])
def test_is_entertainment_true(slug):
    assert is_entertainment(slug)


@pytest.mark.parametrize("slug", ["recipe", "workout", "product", "travel", "book", "fitness"])
def test_is_entertainment_false(slug):
    assert not is_entertainment(slug)


def test_entertainment_prompt_registered():
    assert "entertainment" in TYPE_PROMPTS
    assert "titles" in TYPE_PROMPTS["entertainment"]


def test_extraction_parses_titles_array():
    payload = """
    {"content_type":"entertainment-recommendations",
     "title":"5 sci-fi films to watch",
     "ai_summary":"A reel rounding up five must-watch science fiction films.",
     "cover_image_prompt":"a neon spaceship",
     "data":{"listTheme":"sci-fi","titles":[
        {"title":"Arrival","year":"2016","mediaType":"movie"},
        {"title":"Inception","year":"2010","mediaType":"movie","why":"dream heist"}]}}
    """
    parsed = NoteExtraction.model_validate_json(payload)
    assert len(parsed.data["titles"]) == 2
    assert parsed.data["titles"][0]["title"] == "Arrival"
