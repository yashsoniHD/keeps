"""Place family extraction prompt: count-check, source-order ranking, fabrication-safe
completeness, and the optional list-level `facts`. Mirrors test_entertainment.py's pattern of
asserting the schema/rules the model is told to follow."""
from services.gemini import TYPE_PROMPTS, is_places


def test_place_prompt_registered():
    assert "place" in TYPE_PROMPTS
    assert "venues" in TYPE_PROMPTS["place"]


def test_place_prompt_has_count_check():
    prompt = TYPE_PROMPTS["place"]
    assert "COUNT CHECK" in prompt
    assert "exactly that many" in prompt


def test_place_prompt_has_source_order_ranking():
    prompt = TYPE_PROMPTS["place"]
    assert "source's own order" in prompt
    assert "array position IS the ranking" in prompt
    # array order is the single source of truth — no separate rank field.
    assert "no separate rank field" in prompt


def test_place_prompt_requires_why_or_highlights():
    prompt = TYPE_PROMPTS["place"]
    assert "at least one of `why` or `highlights`" in prompt
    # bare-named venues fall back to the list's framing, never invented attributes.
    assert "NEVER invent dishes" in prompt


def test_place_prompt_has_list_level_facts():
    prompt = TYPE_PROMPTS["place"]
    assert '"facts"?' in prompt
    assert "at-a-glance facts ABOUT THE LIST" in prompt


def test_is_places_family_still_routes_to_place_prompt():
    # sanity: an invented place slug still maps to the place family (extraction picks this prompt)
    assert is_places("rooftop-bars")
