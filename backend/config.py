import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    PROJECT_NAME = "Clip Note API"
    VERSION = "1.0.0"

    GOOGLE_CLOUD_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "weekly-updates-automation")
    GOOGLE_CLOUD_LOCATION: str = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    # Gemini 3.x models are served from the `global` endpoint only (404 on us-central1);
    # infra (Cloud Tasks, GCS, Firestore) stays regional.
    GEMINI_LOCATION: str = os.getenv("GEMINI_LOCATION", "global")

    # Verified against the live Vertex AI catalog at Phase 0 (see phase0/REPORT.md).
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    GEMINI_LITE_MODEL: str = os.getenv("GEMINI_LITE_MODEL", "gemini-3.1-flash-lite")
    IMAGEN_MODEL: str = os.getenv("IMAGEN_MODEL", "imagen-3.0-generate-002")

    # Semantic search embeddings (Firestore Vector Search). text-embedding-005 is a
    # REGIONAL model (us-central1) — unlike the 3.x chat models it is NOT on the global
    # endpoint, so it uses GOOGLE_CLOUD_LOCATION. 768 dims = its native size; the vector
    # index dimension in infra MUST match this exactly.
    EMBED_MODEL: str = os.getenv("EMBED_MODEL", "text-embedding-005")
    EMBED_LOCATION: str = os.getenv("EMBED_LOCATION", os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"))
    EMBED_DIM: int = int(os.getenv("EMBED_DIM", "768"))
    # Top-K notes returned by a semantic search.
    SEARCH_LIMIT: int = int(os.getenv("SEARCH_LIMIT", "20"))

    CLOUD_TASKS_QUEUE: str = os.getenv("CLOUD_TASKS_QUEUE", "clip-note-jobs")
    CLOUD_TASKS_LOCATION: str = os.getenv("CLOUD_TASKS_LOCATION", "us-central1")
    CLOUD_TASKS_WORKER_URL: str = os.getenv("CLOUD_TASKS_WORKER_URL", "http://localhost:8080")
    # OIDC, not a shared secret: tasks are signed by this SA; the worker validates the token.
    CLOUD_TASKS_SA_EMAIL: str = os.getenv("CLOUD_TASKS_SA_EMAIL", "")

    CLOUD_STORAGE_BUCKET: str = os.getenv("CLOUD_STORAGE_BUCKET", "")
    # Public-read bucket for note cover images. Kept separate from the media bucket
    # (which holds private video downloads) so covers can be served to the browser by
    # https URL — persisting them here fixes expiring/hot-linked source thumbnails.
    COVERS_BUCKET: str = os.getenv("COVERS_BUCKET", "")

    # Public-facing app origin — used to build shareable note links (/p/{id}).
    PUBLIC_APP_URL: str = os.getenv("PUBLIC_APP_URL", "https://clipnote.web.app")

    TEMP_DOWNLOAD_DIR: str = os.getenv("TEMP_DOWNLOAD_DIR", "/tmp/clip_note_downloads")

    # Cost guardrails (budget ~$360 total).
    MAX_NOTES_PER_USER: int = int(os.getenv("MAX_NOTES_PER_USER", "500"))
    MAX_INGESTS_PER_USER_PER_DAY: int = int(os.getenv("MAX_INGESTS_PER_USER_PER_DAY", "50"))
    DAILY_GLOBAL_NOTE_CAP: int = int(os.getenv("DAILY_GLOBAL_NOTE_CAP", "1000"))
    MAX_ASKS_PER_USER_PER_DAY: int = int(os.getenv("MAX_ASKS_PER_USER_PER_DAY", "30"))
    DAILY_GLOBAL_ASK_CAP: int = int(os.getenv("DAILY_GLOBAL_ASK_CAP", "300"))
    # How many full notes get sent to the answering model per ask.
    ASK_MAX_GROUNDED_NOTES: int = int(os.getenv("ASK_MAX_GROUNDED_NOTES", "12"))
    # Candidate notes the vector shortlist hands the lite selector per ask (hybrid
    # retrieval). Larger than ASK_MAX_GROUNDED_NOTES so the selector has room to choose.
    ASK_SHORTLIST_K: int = int(os.getenv("ASK_SHORTLIST_K", "25"))

    # Direct-URI video analysis cap. YouTube videos longer than this fall back to the
    # transcript path instead of being sent to Gemini whole.
    MAX_VIDEO_SECONDS: int = int(os.getenv("MAX_VIDEO_SECONDS", "1800"))  # 30 min

    # Max size for downloaded social media files we upload to GCS for analysis.
    MAX_MEDIA_DOWNLOAD_MB: int = int(os.getenv("MAX_MEDIA_DOWNLOAD_MB", "100"))

    # Optional: path to a Netscape cookies file for yt-dlp (Instagram/Facebook).
    # Locally this can come from --cookies-from-browser; on Cloud Run from Secret Manager.
    YTDLP_COOKIES_FILE: str = os.getenv("YTDLP_COOKIES_FILE", "")
    # Local convenience: browser to pull cookies from (e.g. "chrome"). Empty disables.
    YTDLP_COOKIES_FROM_BROWSER: str = os.getenv("YTDLP_COOKIES_FROM_BROWSER", "")

    # Optional Firecrawl API key for bot-protected product pages (tier 2 fallback).
    FIRECRAWL_API_KEY: str = os.getenv("FIRECRAWL_API_KEY", "")
    # Optional Jina Reader key (r.jina.ai works keyless at low volume; key raises limits).
    JINA_API_KEY: str = os.getenv("JINA_API_KEY", "")

    # Imagen covers DEFERRED for MVP. Covers come from og:image → thumbnail → gradient.
    ENABLE_IMAGEN: bool = os.getenv("ENABLE_IMAGEN", "false").lower() == "true"
    VISUAL_CONTENT_TYPES: set[str] = {"recipe", "product", "itinerary", "travel", "place", "fashion", "workout"}

    # --- Admin dashboard ---
    # Emails allowed to read /api/admin/stats (comma-separated). Gating is by verified
    # Firebase email, not uid, so it's set-and-forget across re-signups.
    ADMIN_EMAILS: set[str] = {
        e.strip().lower()
        for e in os.getenv("ADMIN_EMAILS", "yashsoni102@gmail.com").split(",")
        if e.strip()
    }

    # Vertex AI Gemini token pricing, USD per 1,000,000 tokens. We store raw token
    # counts (immutable facts) and derive cost at read-time from these, so a price
    # change re-prices history correctly. Paid-tier Standard rates (confirmed against
    # the live pricing page, 2026-06-12); output includes thinking tokens. Lite input
    # uses the text/image/video rate ($0.25; audio would be $0.50 — we send no audio).
    GEMINI_PRICE_IN: float = float(os.getenv("GEMINI_PRICE_IN", "1.50"))
    GEMINI_PRICE_OUT: float = float(os.getenv("GEMINI_PRICE_OUT", "9.00"))
    GEMINI_LITE_PRICE_IN: float = float(os.getenv("GEMINI_LITE_PRICE_IN", "0.25"))
    GEMINI_LITE_PRICE_OUT: float = float(os.getenv("GEMINI_LITE_PRICE_OUT", "1.50"))
    USD_TO_INR: float = float(os.getenv("USD_TO_INR", "84.0"))


settings = Settings()
