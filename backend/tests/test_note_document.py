import copy
import json
import time

import pytest

from config import settings
from models.note import ContentBundle
from services.gemini import JSON_NUDGE, GeminiService, job_deadline, parse_json
from services.note_document import COMPOSE_PROMPT, EVIDENCE_PROMPT, REVIEW_PROMPT, generate_document
from services.embeddings import note_embedding_text
from services.firebase import firestore_safe

PACKET = {"content_type": "cooking", "title": "Fix a sticking dosa", "ai_summary": "Let the pan heat before pouring.",
          "evidence": [{"id": "e1", "text": "Let the pan heat before pouring.", "source": "video", "timestamp": "00:12"},
                       {"id": "e2", "text": "The creator tests the heat with a drop of water.", "source": "video"}]}
DRAFT = {"title": "Fix a sticking dosa", "ai_summary": "Preheat and test the pan.",
         "document": {"version": 1, "blocks": [
             {"kind": "steps", "heading": "Check the heat", "items": ["Preheat the pan.", "Test with a drop of water."], "evidence_ids": ["e1", "e2"]}]}}


def run(monkeypatch, replies, **kw):
    calls = []
    monkeypatch.setattr(settings, "NOTE_REVIEW_ENABLED", True)
    def chat(chain, system, payload, **kwargs):
        calls.append((chain, system, payload, kwargs))
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return (reply if isinstance(reply, str) else json.dumps(reply)), chain[0], "stop"
    note, model = generate_document(chat, parse_json, ["video-model"], "source context", "", **kw)
    return note, calls


def test_separate_evidence_composition_review_and_media_once(monkeypatch):
    note, calls = run(monkeypatch, [PACKET, DRAFT, {"decision": "pass"}], video_url="video", timeout=90)
    assert len(calls) == 3
    assert calls[0][3]["video_url"] == "video"
    assert all("video_url" not in c[3] for c in calls[1:])
    assert json.loads(calls[2][2])["evidence"]["evidence"] == PACKET["evidence"]
    assert note.data["document"]["blocks"][0]["kind"] == "steps"
    assert note.data["_quality"]["review"] == "passed"
    assert note.data["_evidence"] == PACKET["evidence"]


def test_one_revision_and_immutable_evidence(monkeypatch):
    revised = copy.deepcopy(DRAFT)
    revised["document"]["blocks"][0]["kind"] = "list"
    note, calls = run(monkeypatch, [PACKET, DRAFT, {"decision": "revise", "issues": ["Not a complete procedure"], "revision": revised}],
                      video_url="video")
    assert len(calls) == 3
    assert note.data["document"]["blocks"][0]["kind"] == "list"
    assert note.data["_quality"]["review"] == "revised"
    assert note.data["_evidence"] == PACKET["evidence"]


@pytest.mark.parametrize("reply", [TimeoutError(), {"decision": "revise"}, {"decision": "oops"}])
def test_review_failure_preserves_valid_draft(monkeypatch, reply):
    note, _ = run(monkeypatch, [PACKET, DRAFT, reply])
    assert note.title == DRAFT["title"]
    assert note.data["_quality"]["review"] == "failed"


def test_unknown_evidence_in_revision_rejected(monkeypatch):
    revised = copy.deepcopy(DRAFT)
    revised["document"]["blocks"][0]["evidence_ids"] = ["invented"]
    note, _ = run(monkeypatch, [PACKET, DRAFT, {"decision": "revise", "revision": revised}])
    assert note.data["_quality"]["review"] == "failed"
    assert note.data["document"]["blocks"][0]["evidence_ids"] == ["e1", "e2"]


def test_composition_failure_retains_attributed_source_details(monkeypatch):
    packet = copy.deepcopy(PACKET)
    packet["evidence"][0]["source"] = "comment"
    note, calls = run(monkeypatch, [packet, ValueError("malformed")])
    assert len(calls) == 2
    assert note.data["_quality"]["composition"] == "fallback"
    assert note.data["document"]["blocks"][0]["items"][0].startswith("Comment: ")


def test_budget_skips_editorial_calls(monkeypatch):
    times = iter([0, 0, 20])
    monkeypatch.setattr("services.note_document.time.monotonic", lambda: next(times))
    note, calls = run(monkeypatch, [PACKET], deadline=30)
    assert len(calls) == 1
    assert note.data["_quality"]["composition"] == "fallback"


def test_review_budget_skip(monkeypatch):
    times = iter([0, 0, 1, 25])
    monkeypatch.setattr("services.note_document.time.monotonic", lambda: next(times))
    note, calls = run(monkeypatch, [PACKET, DRAFT], deadline=50)
    assert len(calls) == 2
    assert note.data["_quality"]["review"] == "skipped_budget"


def test_tables_store_in_firestore_and_evidence_not_embedded(monkeypatch):
    draft = copy.deepcopy(DRAFT)
    draft["document"]["blocks"] = [{"kind": "table", "columns": ["Step", "Cue"],
        "rows": [["Preheat", "Water drop"]], "evidence_ids": ["e1", "e2"]}]
    note, _ = run(monkeypatch, [PACKET, draft, {"decision": "pass"}])
    stored = firestore_safe(note.data)
    assert stored["document"]["blocks"][0]["rows"] == [{"cells": ["Preheat", "Water drop"]}]
    embedded = note_embedding_text(note.title, note.ai_summary, stored)
    assert "_evidence" not in embedded and "_quality" not in embedded
    assert "Water drop" in embedded


@pytest.mark.parametrize("mode", ["text", "image", "youtube", "video"])
def test_new_pipeline_integrated_for_every_source(monkeypatch, mode):
    monkeypatch.setattr(settings, "NOTE_DOCUMENTS_ENABLED", True)
    monkeypatch.setattr(settings, "NOTE_REVIEW_ENABLED", False)
    service = GeminiService()
    calls = []
    replies = [PACKET, DRAFT]
    def chat(*args, **kw):
        calls.append(kw)
        return json.dumps(replies.pop(0)), "model", "stop"
    monkeypatch.setattr(service, "_chat_full", chat)
    if mode == "video":
        note = service._extract_from_video(b"video", "video/mp4", "caption", [], "recipe")
    else:
        bundle = ContentBundle(kind="text", text="caption", strategy="test")
        if mode == "image":
            bundle.image_parts = [{"data": b"image", "mime_type": "image/jpeg"}]
        if mode == "youtube":
            bundle.video_uri = "https://www.youtube.com/watch?v=abc"
        note = service.extract("https://example.com", bundle, "recipe")
    assert note.content_type == "recipe"  # category does not dictate structure
    assert "document" in note.data
    assert len(calls) == 2
    assert ("video_url" in calls[0]) == (mode in {"youtube", "video"})


def test_duplicate_evidence_rejected(monkeypatch):
    packet = copy.deepcopy(PACKET)
    packet["evidence"][1]["id"] = "e1"
    with pytest.raises(ValueError, match="duplicate evidence"):
        run(monkeypatch, [packet, packet])  # text sources retry the evidence stage once


def test_review_cannot_add_clickable_unsourced_links(monkeypatch):
    draft = copy.deepcopy(DRAFT)
    draft["document"]["blocks"][0]["links"] = [
        {"label": "Bad", "url": "javascript:alert(1)"},
        {"label": "Invented", "url": "https://invented.example/"}]
    note, _ = run(monkeypatch, [PACKET, draft, {"decision": "pass"}])
    assert note.data["document"]["blocks"][0]["links"] == []


def test_real_source_links_survive(monkeypatch):
    draft = copy.deepcopy(DRAFT)
    draft["document"]["blocks"][0]["links"] = [{"label": "Guide", "url": "https://example.com/guide"}]
    replies = [PACKET, draft, {"decision": "pass"}]
    monkeypatch.setattr(settings, "NOTE_REVIEW_ENABLED", True)
    def chat(*args, **kwargs):
        return json.dumps(replies.pop(0)), "model", "stop"
    note, _ = generate_document(chat, parse_json, ["model"], "Read https://example.com/guide", "")
    assert note.data["document"]["blocks"][0]["links"][0]["url"] == "https://example.com/guide"


def test_bad_evidence_json_gets_one_text_only_repair_nudge(monkeypatch):
    note, calls = run(monkeypatch, ["Sure! {broken", PACKET, DRAFT, {"decision": "pass"}],
                      video_url="video")
    assert calls[1][1].endswith(JSON_NUDGE) and calls[1][2] == "Sure! {broken"
    assert "video_url" not in calls[1][3]                     # the repair never re-sends media
    assert note.data["_evidence"] == PACKET["evidence"]


def test_evidence_packet_is_tolerant(monkeypatch):
    packet = copy.deepcopy(PACKET)
    packet["extra"] = 1
    packet["evidence"][0].update(source="audio", text="x" * 3000, speaker="creator")
    note, _ = run(monkeypatch, [packet, DRAFT, {"decision": "pass"}], video_url="video")
    ev = note.data["_evidence"][0]
    assert ev["source"] == "video" and len(ev["text"]) == 2400 and "speaker" not in ev


def test_text_source_labels_transcript_as_page_and_retries_invalid_packet(monkeypatch):
    note, calls = run(monkeypatch, [{"evidence": []}, PACKET, DRAFT, {"decision": "pass"}])
    assert len(calls) == 4                                    # one evidence retry
    assert {e["source"] for e in note.data["_evidence"]} == {"page"}


def test_video_source_does_not_retry_invalid_packet(monkeypatch):
    with pytest.raises(ValueError):
        run(monkeypatch, [{"evidence": []}], video_url="video")


def test_deterministic_draft_fixes(monkeypatch):
    packet = copy.deepcopy(PACKET)
    packet["evidence"].append({"id": "c1", "text": "My dosa tips!", "source": "caption"})
    draft = {"title": "**Crispy Dosa Batter That Never Sticks To Any Pan At All Ever Again** Recipe",
             "ai_summary": "Preheat and test the pan.",
             "document": {"version": 1, "blocks": [
                 {"kind": "steps", "heading": "## Ingredients", "items": ["**1 cup** rice"], "evidence_ids": ["e1"]},
                 {"kind": "quote", "heading": "Caption", "items": ["My dosa tips!"], "evidence_ids": ["c1"]},
                 {"kind": "code", "heading": "Code", "items": ["__init__"], "evidence_ids": ["e2"]}]}}
    note, _ = run(monkeypatch, [packet, draft, {"decision": "pass"}], video_url="video")
    blocks = note.data["document"]["blocks"]
    assert note.title.startswith("Crispy Dosa Batter") and note.title.endswith("…")
    assert len(note.title) <= 60 and "*" not in note.title and "Recipe" not in note.title
    assert blocks[0]["kind"] == "checklist" and blocks[0]["heading"] == "Ingredients"
    assert blocks[0]["items"] == ["1 cup rice"]
    assert [b["kind"] for b in blocks] == ["checklist", "code"]    # caption quote dropped
    assert blocks[1]["items"] == ["__init__"]                      # code left untouched
    assert note.data["_quality"].get("lint") is None


def test_title_filler_stripped():
    from services.note_document import Draft
    d = Draft(title="Paneer butter garlic recipe", ai_summary="s",
              document={"blocks": [{"kind": "text", "items": ["x"], "evidence_ids": ["e1"]}]})
    assert d.title == "Paneer butter garlic"


def test_lint_reaches_review_and_long_summary_is_cut(monkeypatch):
    draft = copy.deepcopy(DRAFT)
    draft["ai_summary"] = "A recipe for dosa. " + "Preheat the pan well " * 15
    draft["document"]["blocks"].append({"kind": "text", "items": ["More."], "evidence_ids": ["e1"]})
    note, calls = run(monkeypatch, [PACKET, draft, {"decision": "pass"}])
    issues = json.loads(calls[2][2])["known_issues"]
    assert len(issues) == 3 and note.data["_quality"]["lint"] == issues
    assert note.ai_summary == "A recipe for dosa."                 # first sentence, ≤200


def test_prompts_carry_style_actionability_and_language_rules():
    for prompt in (EVIDENCE_PROMPT, COMPOSE_PROMPT):
        assert "2-6 words" in prompt and "15-25 words" in prompt
    assert "(translated)" in COMPOSE_PROMPT and "(translated)" in REVIEW_PROMPT
    assert "(translated)" not in EVIDENCE_PROMPT           # evidence stays verbatim
    assert "Try this" in COMPOSE_PROMPT and "no\n'steps' block" in COMPOSE_PROMPT
    assert "known_issues" in REVIEW_PROMPT and "not steps" in REVIEW_PROMPT


@pytest.mark.parametrize("raw,plain", [
    ("**1 cup** rice", "1 cup rice"), ("__very good__ tip", "very good tip"),
    ("## Ingredients", "Ingredients"), ("call __init__ first", "call __init__ first"),
    ("2**10 and 3**4", "2**10 and 3**4"), ("snake_case__name", "snake_case__name")])
def test_plain_strips_only_paired_markdown(raw, plain):
    from services.note_document import _plain
    assert _plain(raw) == plain


@pytest.mark.parametrize("heading,match", [
    ("Ingredients", True), ("Equipment", True), ("What you'll need", True),
    ("Packing list", True), ("What to pack", True),
    ("How to package leftovers", False), ("Main ingredients explained", False)])
def test_gather_heading(heading, match):
    from services.note_document import _GATHER_HEADING
    assert bool(_GATHER_HEADING.search(heading)) is match
