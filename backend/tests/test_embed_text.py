"""services.embeddings.note_embedding_text: the note-embedding text recipe (title + summary +
flattened `data` excerpt) that lets search match a note's content, not just its headline."""
from datetime import datetime, timezone

from config import settings
from services.embeddings import EMBED_TEXT_VERSION, note_embedding_text


def test_data_is_flattened_into_the_text():
    text = note_embedding_text(
        "Butter chicken", "A slow-cooked curry.",
        {"ingredients": ["chicken thighs", "garam masala", "kasuri methi"]},
    )
    assert "Butter chicken" in text
    assert "A slow-cooked curry." in text
    # Content the title/summary never mention is now embeddable.
    assert "garam masala" in text
    assert "kasuri methi" in text


def test_none_and_empty_data_degrade_to_title_and_summary():
    assert note_embedding_text("Title", "Summary", None) == "Title\nSummary"
    assert note_embedding_text("Title", "Summary", {}) == "Title\nSummary"


def test_blank_title_and_summary_returns_only_data():
    text = note_embedding_text("", "", {"body": "just a body"})
    assert "just a body" in text
    assert not text.startswith("\n")


def test_all_blank_returns_empty_string():
    assert note_embedding_text("", "", None) == ""
    assert note_embedding_text("  ", "  ", {}) == ""


def test_data_excerpt_is_truncated():
    big = {"body": "x" * (settings.EMBED_NOTE_DATA_EXCERPT_CHARS + 5000)}
    text = note_embedding_text("T", "S", big)
    # title + "\n" + summary + "\n" + at-most-EXCERPT chars of the dumped data.
    header = "T\nS\n"
    assert len(text) <= len(header) + settings.EMBED_NOTE_DATA_EXCERPT_CHARS


def test_datetime_values_in_data_do_not_crash():
    text = note_embedding_text(
        "T", "S", {"created": datetime(2026, 7, 15, tzinfo=timezone.utc)})
    assert "2026-07-15" in text


def test_version_constant_is_current():
    assert EMBED_TEXT_VERSION == 3
