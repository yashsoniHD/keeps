"""Request/response shapes for the Ask AI endpoint (chat grounded in saved notes)."""
from typing import Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=20)


class Citation(BaseModel):
    id: str
    title: str
    content_type: str
    cover_image_url: str | None = None
    source_domain: str = ""


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation] = Field(default_factory=list)


class NoteSelection(BaseModel):
    """Stage-1 Gemini output: which notes could help answer the question."""
    note_ids: list[str] = Field(default_factory=list)


class GroundedAnswer(BaseModel):
    """Stage-2 Gemini output: the grounded answer plus the notes it actually used."""
    answer_markdown: str
    cited_note_ids: list[str] = Field(default_factory=list)
