"""Category consolidation pressure (audit #9): the classifier must not grow a user's
taxonomy without bound. Two enforcement layers are pinned here:

  * closest_existing(): the pure token-overlap heuristic that snaps a net-new slug onto the
    most similar EXISTING category once the taxonomy is full.
  * GeminiService.classify(): at/over MAX_USER_CATEGORIES it appends nothing — a brand-new
    slug from the model is mapped to an existing one; under the cap it still mints new slugs.

The lite model call is faked (no network); we only assert the routing logic around it.
"""
import pytest

from config import settings
from models.note import ContentBundle
from services.gemini import CATEGORY_CAP_RULE, closest_existing, gemini_service


from conftest import chat_resp as _FakeResp  # noqa: E402


def _bundle():
    return ContentBundle(
        kind="text",
        text="Soft fluffy idli with coconut chutney and sambar",
        metadata={"platform": "web", "title": "Idli dosa breakfast"},
        strategy="web_scrape",
    )


def _patch_model(monkeypatch, returned_slug):
    """Fake the lite categorizer to return a fixed slug, and capture the system prompt it saw."""
    seen: dict = {}

    def fake_generate(*args, **kwargs):
        seen["kwargs"] = kwargs
        return _FakeResp('{"content_type": "%s"}' % returned_slug)

    monkeypatch.setattr(gemini_service.client.chat.completions, "create", fake_generate)
    return seen


# ---------------- closest_existing (pure heuristic) ----------------

def test_closest_existing_token_overlap_wins():
    assert closest_existing("veg-biryani-recipe", ["recipe", "travel", "fitness"]) == "recipe"


def test_closest_existing_folds_plural():
    assert closest_existing("movies", ["movie", "recipe"]) == "movie"


def test_closest_existing_no_overlap_prefers_generic_bucket():
    assert closest_existing("quantum-physics", ["summary", "recipe"]) == "summary"


def test_closest_existing_no_overlap_no_generic_falls_to_first():
    assert closest_existing("zzz", ["recipe", "travel"]) == "recipe"


# ---------------- classify() cap enforcement ----------------

def _fifteen():
    """A full taxonomy: exactly MAX_USER_CATEGORIES slugs, one of which shares a token
    with the model's net-new answer below ("recipe")."""
    base = ["recipe", "travel", "fitness", "product", "book", "career", "finance",
            "music", "art", "news", "science", "home", "fashion", "gaming", "summary"]
    return base[: settings.MAX_USER_CATEGORIES]


async def test_at_cap_snaps_new_slug_to_existing(monkeypatch):
    seen = _patch_model(monkeypatch, "idli-dosa-recipe")  # net-new, shares "recipe"
    existing = _fifteen()
    slug = await gemini_service.classify("http://x", _bundle(), existing)
    assert slug == "recipe"          # snapped, not appended
    assert slug in existing          # taxonomy never grows
    # the model was also TOLD the list is full
    assert CATEGORY_CAP_RULE in seen["kwargs"]["messages"][0]["content"]


async def test_at_cap_reuses_exact_existing(monkeypatch):
    _patch_model(monkeypatch, "recipe")
    existing = _fifteen()
    slug = await gemini_service.classify("http://x", _bundle(), existing)
    assert slug == "recipe"


async def test_under_cap_allows_new_slug(monkeypatch):
    seen = _patch_model(monkeypatch, "home-decor")
    existing = ["recipe"]            # well under the cap
    slug = await gemini_service.classify("http://x", _bundle(), existing)
    assert slug == "home-decor"      # a genuinely new category is still minted
    assert CATEGORY_CAP_RULE not in seen["kwargs"]["messages"][0]["content"]


async def test_cap_boundary_is_inclusive(monkeypatch):
    """At exactly the cap the rule already applies (>=, not >)."""
    monkeypatch.setattr(settings, "MAX_USER_CATEGORIES", 2)
    _patch_model(monkeypatch, "brand-new-thing")
    existing = ["recipe", "travel"]  # len == cap
    slug = await gemini_service.classify("http://x", _bundle(), existing)
    assert slug in existing


# ---------------- classify() no longer routes collection membership ----------------

async def test_classify_returns_content_type_only(monkeypatch):
    """classify() is content_type-only now — smart-collection membership was moved to
    embedding match at ingest (services.collections.match_collections_by_embedding), so
    classify no longer takes a `collections` argument and never returns a collection_id."""
    _patch_model(monkeypatch, "recipe")
    result = await gemini_service.classify("http://x", _bundle(), ["recipe"])
    assert result == "recipe"  # a bare string, not a (content_type, collection_id) tuple


def test_collection_rule_removed_from_gemini_module():
    """COLLECTION_RULE (the classifier prompt block that used to ask the model to also pick a
    collection_id) no longer exists — dropping it also shaves the classify call's output tokens."""
    import services.gemini as gemini_mod
    assert not hasattr(gemini_mod, "COLLECTION_RULE")


async def test_assign_category_back_compat_alias_still_works(monkeypatch):
    """assign_category is a thin back-compat alias for classify (kept for any external caller
    of the old name) — still content_type-only."""
    _patch_model(monkeypatch, "travel")
    result = await gemini_service.assign_category("http://x", _bundle(), ["travel"])
    assert result == "travel"
