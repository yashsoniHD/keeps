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

    CLOUD_TASKS_QUEUE: str = os.getenv("CLOUD_TASKS_QUEUE", "clip-note-jobs")
    CLOUD_TASKS_LOCATION: str = os.getenv("CLOUD_TASKS_LOCATION", "us-central1")
    CLOUD_TASKS_WORKER_URL: str = os.getenv("CLOUD_TASKS_WORKER_URL", "http://localhost:8080")
    # OIDC, not a shared secret: tasks are signed by this SA; the worker validates the token.
    CLOUD_TASKS_SA_EMAIL: str = os.getenv("CLOUD_TASKS_SA_EMAIL", "")

    CLOUD_STORAGE_BUCKET: str = os.getenv("CLOUD_STORAGE_BUCKET", "")

    TEMP_DOWNLOAD_DIR: str = os.getenv("TEMP_DOWNLOAD_DIR", "/tmp/clip_note_downloads")

    # Cost guardrails (budget ~$360 total).
    MAX_NOTES_PER_USER: int = int(os.getenv("MAX_NOTES_PER_USER", "500"))
    MAX_INGESTS_PER_USER_PER_DAY: int = int(os.getenv("MAX_INGESTS_PER_USER_PER_DAY", "50"))
    DAILY_GLOBAL_NOTE_CAP: int = int(os.getenv("DAILY_GLOBAL_NOTE_CAP", "1000"))

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

    # Imagen covers DEFERRED for MVP. Covers come from og:image → thumbnail → gradient.
    ENABLE_IMAGEN: bool = os.getenv("ENABLE_IMAGEN", "false").lower() == "true"
    VISUAL_CONTENT_TYPES: set[str] = {"recipe", "product", "itinerary", "travel", "place", "fashion", "workout"}


settings = Settings()
