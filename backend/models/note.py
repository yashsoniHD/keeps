from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator


class IngestRequest(BaseModel):
    # The capture's origin shape. "url" is the historic default; the rest let the user
    # save things that aren't a clean link (a typed thought, a screenshot, a PDF, a voice
    # memo). Binary inputs (image/pdf/voice) arrive pre-uploaded to GCS via /ingest/upload,
    # so the request only carries a reference (media_gcs_uri), never the bytes.
    input_type: Literal["url", "text", "image", "pdf", "voice", "video"] = "url"
    # Size ceilings reject junk at the model boundary instead of carrying megabytes of body
    # into Firestore job docs (the worker additionally truncates text/content to 30k chars).
    url: str = Field(default="", max_length=4096)  # required only when input_type == "url"
    text: str | None = Field(default=None, max_length=100_000)  # note body (input_type "text")
    # Typed notes only: when False the note is saved verbatim (no Gemini extraction) — the
    # raw text becomes the body, the user titles/tags it themselves. Default True keeps the
    # AI-structured behaviour for every other path.
    process_ai: bool = True
    title: str | None = Field(default=None, max_length=300)  # user-supplied title (non-url inputs)
    media_gcs_uri: str | None = None   # gs:// URI of the uploaded file (image/pdf/voice/video)
    media_mime: str | None = None      # MIME of the uploaded file (Vertex needs it on FileData)
    media_cover_url: str | None = None # public https cover (images double as their own cover)
    content: str | None = Field(default=None, max_length=200_000)  # device-extracted page text (PWA/shortcut)
    source: str = "web"                # "web" | "shortcut" | "pwa" | "ai_chat" | "upload"
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
                    return tok
        return v


class ContentBundle(BaseModel):
    """Normalized output of a source strategy — the single input shape the AI pipeline consumes.

    kind:
      video_uri  — Gemini analyzes the video directly (YouTube URL or gs:// URI)
      text       — scraped/extracted text (articles, reddit threads, captions, typed notes)
      structured — JSON-LD found on the page; passed to Gemini verbatim as ground truth
      image      — a user-saved image/screenshot, ingested by gs:// URI (media_uri)
      document   — a user-saved PDF (or audio), ingested by gs:// URI (media_uri)
    A bundle may carry several of these at once (e.g. text + structured); `kind` records the
    primary acquisition path for reporting.
    """
    kind: Literal["video_uri", "text", "structured", "metadata_only", "image", "document"]
    text: str | None = None
    video_uri: str | None = None
    # Any non-video media (image / PDF / audio) Gemini ingests by gs:// URI, mirroring the
    # video_uri path. Vertex requires an explicit mimeType on FileData (image/jpeg,
    # application/pdf, audio/mp4, …) — set media_mime accordingly.
    media_uri: str | None = None
    media_mime: str | None = None
    structured: dict[str, Any] | None = None
    images: list[str] = Field(default_factory=list)
    # Image bytes to hand Gemini as vision input — e.g. every slide of an Instagram
    # carousel, so the note reflects the whole post, not just slide 1's caption. Each item
    # is {"mime_type": str, "data": bytes}. Distinct from `images` (URLs used only for the
    # cover). Empty for text/video sources.
    image_parts: list[dict[str, Any]] = Field(default_factory=list)
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
