"""Request/response shapes for the Ask AI endpoint (chat grounded in saved notes)."""
from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)
    # Minutes EAST of UTC (frontend sends -new Date().getTimezoneOffset()), so the
    # backend can resolve "today"/"this week" against the user's local day, not UTC's.
    tz_offset_minutes: int = Field(default=0, ge=-840, le=840)


class Citation(BaseModel):
    id: str
    title: str
    content_type: str
    cover_image_url: str | None = None
    source_domain: str = ""


class ArtifactNote(BaseModel):
    """An AI-built note the user can save from chat: a consolidation across several notes
    (Phase 2) or a fresh note authored from the conversation (Phase 4). Carries the COMPOSER
    block schema in `data` so the frontend renders it with the existing GenericNote blocks."""
    title: str = ""
    ai_summary: str = ""
    content_type: str = "summary"   # friendly category slug (icon/pill only — render is generic)
    data: dict[str, Any] = Field(default_factory=dict)
    origin: Literal["consolidated", "created"] = "consolidated"  # provenance for the saved note


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    # Human-readable note coverage ("Based on 6 of 12 matching notes."), surfaced in
    # the UI so silent top-K/cap truncation is visible. None for general-chat answers.
    coverage: str | None = None
    # Present when the user asked to consolidate notes into a structured artifact
    # (output != prose); the UI renders it and offers "Save as note".
    artifact: ArtifactNote | None = None


PERIODS = ("today", "yesterday", "this_week", "last_week", "this_month", "recent")
Period = Literal["today", "yesterday", "this_week", "last_week", "this_month", "recent"]


class AskPlan(BaseModel):
    """Stage-1 lite-model output: a structured filter set describing how to answer.

    Replaces the old single-mode NoteSelection — retrieval builds a query from these
    fields, so temporal, semantic, type, exhaustive, and combined asks all work, and
    `scope=general` routes to a plain conversational answer with no note retrieval.
    """
    intent: Literal["answer", "aggregate", "create"] = "answer"
    scope: Literal["notes", "general"] = "notes"
    topic: str | None = None                       # semantic query for vector (may differ from raw message)
    period: Period | None = None                   # temporal filter; backend → exact bounds
    content_types: list[str] = Field(default_factory=list)
    source: str | None = None                      # site/app the note came from ("pinterest", "nytimes")
    exhaustive: bool = False                        # "all/every/consolidate" → full filtered set, not top-K
    output: Literal["prose", "itinerary", "meal_plan", "comparison", "checklist"] = "prose"
    note_ids: list[str] = Field(default_factory=list)


class GroundedAnswer(BaseModel):
    """Stage-2 Gemini output: the answer plus the notes it actually used."""
    answer_markdown: str
    cited_note_ids: list[str] = Field(default_factory=list)


class SynthAnswer(BaseModel):
    """Stage-2 output when consolidating notes into a structured artifact."""
    answer_markdown: str = ""          # one short lead-in line introducing the artifact
    artifact: ArtifactNote
    cited_note_ids: list[str] = Field(default_factory=list)
