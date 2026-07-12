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
    # Focal note when the chat is opened from a note's page: that note is forced into the
    # grounding set and ranked first ("this note first, then all"). None = corpus-wide.
    note_id: str | None = Field(default=None, max_length=128)
    # Explicit reference scope: when non-empty, the agent grounds ONLY on these notes
    # (ownership-checked), bypassing vector/temporal retrieval. Empty = default scope.
    selected_note_ids: list[str] = Field(default_factory=list, max_length=20)
    # Resume/persist a saved conversation. None on the first message of a new chat — the
    # server mints an id and returns it (a `conversation` SSE event) so the client can track it.
    conversation_id: str | None = Field(default=None, max_length=128)


class Citation(BaseModel):
    id: str
    title: str
    content_type: str
    cover_image_url: str | None = None
    source_domain: str = ""
    ref_id: str | None = None  # the underlying note id (same as id); kept for client back-compat


class ArtifactNote(BaseModel):
    """An AI-built note the user can save from chat: a consolidation across several notes
    (Phase 2) or a fresh note authored from the conversation (Phase 4). Carries the COMPOSER
    block schema in `data` so the frontend renders it with the existing GenericNote blocks."""
    title: str = ""
    ai_summary: str = ""
    content_type: str = "summary"   # friendly category slug (icon/pill only — render is generic)
    data: dict[str, Any] = Field(default_factory=dict)
    origin: Literal["consolidated", "created"] = "consolidated"  # provenance for the saved note


class FactItem(BaseModel):
    """One key/value stat in a facts block — the same {label, value} shape used inline in the
    COMPOSER/synthesize prompts (services/gemini.py), now a real model for the digest feature."""
    label: str
    value: str


class DigestEntry(BaseModel):
    """One line item in a collection digest section — always deep-links back to the note it
    was drawn from."""
    title: str
    summary: str
    note_id: str


class DigestSection(BaseModel):
    """A themed group within a collection digest (e.g. "Places", "Food", "Tips" for a
    trip-like collection; a topic/category for a topical one).

    v3: the section is a READ of its member notes, not an index into them. `body` is the
    synthesis — 1-3 short paragraphs (plain text, "\\n\\n" between paragraphs) that names the
    specific tools/techniques/steps found in the notes' `data` and connects them across notes,
    the way a person who actually read the notes would explain the section back to you. `items`
    is optional and reserved for genuinely atomic listables (a tool worth its own row) — many
    sections will have body-only prose and an empty items list. `source_note_ids` grounds the
    section as a whole for citation links, independent of which (if any) items it carries."""
    heading: str
    body: str = ""
    items: list[DigestEntry] = Field(default_factory=list)
    source_note_ids: list[str] = Field(default_factory=list)


class CollectionDigest(BaseModel):
    """Cached, composed digest for a smart collection: a short intro, optional at-a-glance
    facts, and categorized sections of entries that deep-link to their source notes. Built by
    Gemini from member notes (services.gemini.build_digest) and cached on the collection doc
    (`collections/{id}.digest`); regenerated lazily when membership has changed since the last
    build (POST /collections/{id}/digest)."""
    intro: str = ""
    facts: list[FactItem] = Field(default_factory=list)
    sections: list[DigestSection] = Field(default_factory=list)
    # Human-readable coverage line ("Digest built from 30 of 45 notes."), set by the endpoint
    # (not the model) when DIGEST_MAX_NOTES truncates the member set. None otherwise.
    coverage: str | None = None


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    # Human-readable note coverage ("Based on 6 of 12 matching notes."), surfaced in
    # the UI so silent top-K/cap truncation is visible. None for general-chat answers.
    coverage: str | None = None
    # Present when the user asked to consolidate notes into a structured artifact
    # (output != prose); the UI renders it and offers "Save as note".
    artifact: ArtifactNote | None = None
    # Present when intent == "save_link" and the note was successfully created.
    saved_note_id: str | None = None


PERIODS = ("today", "yesterday", "this_week", "last_week", "this_month", "recent")
Period = Literal["today", "yesterday", "this_week", "last_week", "this_month", "recent"]


class AskPlan(BaseModel):
    """Stage-1 lite-model output: a structured filter set describing how to answer.

    Replaces the old single-mode NoteSelection — retrieval builds a query from these
    fields, so temporal, semantic, type, exhaustive, and combined asks all work, and
    `scope=general` routes to a plain conversational answer with no note retrieval.
    """
    intent: Literal["answer", "aggregate", "create", "save_link"] = "answer"
    scope: Literal["notes", "general"] = "notes"
    topic: str | None = None                       # semantic query for vector (may differ from raw message)
    period: Period | None = None                   # temporal filter; backend → exact bounds
    content_types: list[str] = Field(default_factory=list)
    source: str | None = None                      # site/app the note came from ("pinterest", "nytimes")
    exhaustive: bool = False                        # "all/every/consolidate" → full filtered set, not top-K
    output: Literal["prose", "itinerary", "meal_plan", "comparison", "checklist"] = "prose"
    note_ids: list[str] = Field(default_factory=list)
    # save_link fields: populated only when intent == "save_link"
    save_url: str | None = None    # the URL extracted from the user's message
    save_hint: str | None = None   # any instructions the user gave alongside the URL


class GroundedAnswer(BaseModel):
    """Stage-2 Gemini output: the answer plus the notes it actually used."""
    answer_markdown: str
    cited_note_ids: list[str] = Field(default_factory=list)


class SynthAnswer(BaseModel):
    """Stage-2 output when consolidating notes into a structured artifact."""
    answer_markdown: str = ""          # one short lead-in line introducing the artifact
    artifact: ArtifactNote
    cited_note_ids: list[str] = Field(default_factory=list)
