from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator

from services.url_utils import canonical_url


class IngestRequest(BaseModel):
    # The capture's origin shape. "url" is the default; "text" is a typed note.
    input_type: Literal["url", "text"] = "url"
    # Size ceilings reject junk at the model boundary instead of carrying megabytes of body
    # into Firestore job docs (the worker additionally truncates text/content to 30k chars).
    url: str = Field(default="", max_length=4096)  # required only when input_type == "url"
    text: str | None = Field(default=None, max_length=100_000)  # note body (input_type "text")
    # Typed notes only: when False the note is saved verbatim (no Gemini extraction) — the
    # raw text becomes the body, the user titles/tags it themselves. Default True keeps the
    # AI-structured behaviour for every other path.
    process_ai: bool = True
    title: str | None = Field(default=None, max_length=300)  # user-supplied title (non-url inputs)
    content: str | None = Field(default=None, max_length=200_000)  # device-extracted page text (PWA/shortcut)
    source: str = "web"                # "web" | "shortcut" | "pwa" | "ai_chat"
    note_hint: str | None = Field(default=None, max_length=500)  # user instructions for Gemini

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
                    return canonical_url(tok)
        return canonical_url(v)


class ContentBundle(BaseModel):
    """Normalized output of a source strategy — the single input shape the AI pipeline consumes.

    kind:
      video_uri  — the model analyzes the video directly (YouTube URL only)
      text       — scraped/extracted text (articles, reddit threads, captions, typed notes)
      structured — JSON-LD found on the page; passed to Gemini verbatim as ground truth
    A bundle may carry several of these at once (e.g. text + structured); `kind` records the
    primary acquisition path for reporting.
    """
    kind: Literal["video_uri", "text", "structured", "metadata_only"]
    text: str | None = None
    video_uri: str | None = None
    structured: dict[str, Any] | None = None
    images: list[str] = Field(default_factory=list)
    # Image bytes to hand Gemini as vision input — e.g. every slide of an Instagram
    # carousel, so the note reflects the whole post, not just slide 1's caption. Each item
    # is {"mime_type": str, "data": bytes}. Distinct from `images` (URLs used only for the
    # cover). Empty for text/video sources.
    image_parts: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    strategy: str = ""           # e.g. "youtube_direct", "reel_caption", "reddit_json"
    # metadata keys beyond title/author/platform: via (ytdlp|apify|og|oembed), tier
    # (caption|transcript|frames), media_url, media_path, workdir, canonical_url, comments.

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
    cover_image_prompt: str = ""
    data: dict[str, Any]  # structured fields only — rendered by React templates, never HTML


class JobStatus(BaseModel):
    job_id: str
    status: str  # pending | processing | completed | failed
    note_id: Optional[str] = None
    error: Optional[str] = None
    message: Optional[str] = None  # human-readable outcome, shown by the iOS Shortcut
