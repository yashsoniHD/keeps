from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator


class IngestRequest(BaseModel):
    url: str
    content: str | None = None   # pre-extracted text (paywall/auth bypass via PWA/shortcut)
    source: str = "web"          # "web" | "shortcut" | "pwa"

    @field_validator("url")
    @classmethod
    def _clean_url(cls, v: str) -> str:
        # Shared URLs (iOS shortcut / share sheet / paste) arrive messy: trailing newlines,
        # or the same link repeated on multiple lines (the Shortcut's "Get URLs" action
        # stringifies multi-matches with \n). httpx rejects any non-printable char in a URL,
        # so sanitize at the boundary — take the first http(s) token.
        v = (v or "").strip()
        if any(c.isspace() for c in v):
            for tok in v.split():
                if tok.startswith(("http://", "https://")):
                    return tok
        return v


class ContentBundle(BaseModel):
    """Normalized output of a source strategy — the single input shape the AI pipeline consumes.

    kind:
      video_uri  — Gemini analyzes the video directly (YouTube URL or gs:// URI)
      text       — scraped/extracted text (articles, reddit threads, captions)
      structured — JSON-LD found on the page; passed to Gemini verbatim as ground truth
    A bundle may carry several of these at once (e.g. text + structured); `kind` records the
    primary acquisition path for reporting.
    """
    kind: Literal["video_uri", "text", "structured", "metadata_only"]
    text: str | None = None
    video_uri: str | None = None
    structured: dict[str, Any] | None = None
    images: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    strategy: str = ""           # e.g. "youtube_direct", "ytdlp_gcs", "reddit_json"

    @property
    def preview(self) -> str:
        """Short content preview for the cheap categorization step."""
        title = self.metadata.get("title", "")
        author = self.metadata.get("author") or ""
        body = (self.text or "")[:400]
        return f"{title} {('by ' + author) if author else ''}\n{body}".strip()


class NoteExtraction(BaseModel):
    content_type: str
    title: str
    ai_summary: str
    cover_image_prompt: str
    data: dict[str, Any]  # structured fields only — rendered by React templates, never HTML


class JobStatus(BaseModel):
    job_id: str
    status: str  # pending | processing | completed | failed
    note_id: Optional[str] = None
    error: Optional[str] = None
