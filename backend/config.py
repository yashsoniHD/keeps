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
    # Per-user daily cap on /api/search — each search embeds the query (a paid Vertex call,
    # tiny but previously unbounded). Generous: real usage is a handful of searches a day.
    MAX_SEARCHES_PER_USER_PER_DAY: int = int(os.getenv("MAX_SEARCHES_PER_USER_PER_DAY", "500"))
    CLOUD_TASKS_QUEUE: str = os.getenv("CLOUD_TASKS_QUEUE", "clip-note-jobs")
    CLOUD_TASKS_LOCATION: str = os.getenv("CLOUD_TASKS_LOCATION", "us-central1")
    CLOUD_TASKS_WORKER_URL: str = os.getenv("CLOUD_TASKS_WORKER_URL", "http://localhost:8080")
    # OIDC, not a shared secret: tasks are signed by this SA; the worker validates the token.
    CLOUD_TASKS_SA_EMAIL: str = os.getenv("CLOUD_TASKS_SA_EMAIL", "")

    # Weekly digest email (Resend). The /digest/run worker is OIDC-authed (same SA as
    # Cloud Tasks) and triggered by Cloud Scheduler. Sends are no-ops until the key + sender
    # are set, so the endpoint is safe to deploy before the provider is wired.
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    DIGEST_FROM_EMAIL: str = os.getenv("DIGEST_FROM_EMAIL", "")  # e.g. "Clipnote <digest@clipnote.app>"
    # Signs unsubscribe links so they work without login but can't be forged.
    DIGEST_UNSUB_SECRET: str = os.getenv("DIGEST_UNSUB_SECRET", "")
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "https://clipnote.web.app")

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
    # Per-user, per-app cap on mini-app backfill runs/day. Backfill writes are idempotent but
    # their Gemini / enrichment-API spend re-incurs each run, so repeats are capped.
    MAX_BACKFILLS_PER_APP_PER_DAY: int = int(os.getenv("MAX_BACKFILLS_PER_APP_PER_DAY", "3"))
    # Per-IP flood guard on the expensive POST endpoints (ingest/ask). In-memory, per Cloud
    # Run instance — abuse protection layered in front of the authoritative cost caps above.
    RATE_LIMIT_PER_MIN: int = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))
    # How many full notes get sent to the answering model per ask.
    ASK_MAX_GROUNDED_NOTES: int = int(os.getenv("ASK_MAX_GROUNDED_NOTES", "12"))
    # Candidate notes the vector shortlist hands the lite planner per ask (hybrid
    # retrieval). Larger than ASK_MAX_GROUNDED_NOTES so the planner has room to choose.
    ASK_SHORTLIST_K: int = int(os.getenv("ASK_SHORTLIST_K", "25"))
    # Most-recent notes always added to the planner's candidate pool (alongside the
    # vector shortlist) so temporal asks ("today", "this week") have the right notes in view.
    ASK_RECENT_POOL: int = int(os.getenv("ASK_RECENT_POOL", "30"))
    # Hard ceiling on notes fed to the answerer for exhaustive/temporal asks ("all my
    # recipes", "consolidate my trip notes") — bounds token cost on a big match set.
    ASK_EXHAUSTIVE_CAP: int = int(os.getenv("ASK_EXHAUSTIVE_CAP", "40"))

    # --- Smart collections backfill (assign pre-existing notes to a new bucket) ---
    # How many nearest notes to consider when a collection is created, and the max COSINE
    # distance (1 - similarity) to still count as a match. Tuned for precision over recall —
    # a missed note can always be moved manually, a wrong one is annoying.
    COLLECTION_BACKFILL_K: int = int(os.getenv("COLLECTION_BACKFILL_K", "50"))
    COLLECTION_BACKFILL_MAX_DISTANCE: float = float(
        os.getenv("COLLECTION_BACKFILL_MAX_DISTANCE", "0.45"))
    # Name+description shorter than this is too thin to embed well ("AI") — expand it into a
    # descriptive query via one lite-model call before the vector sweep.
    COLLECTION_QUERY_EXPAND_BELOW: int = int(os.getenv("COLLECTION_QUERY_EXPAND_BELOW", "48"))

    # --- Agent (orchestrator + subagents + tools) ---
    # Master kill switch: when false, /api/ask/stream answers with no tools (falls back to
    # plain grounded RAG) so the agent path can be disabled without a redeploy.
    ASK_ENABLE_TOOLS: bool = os.getenv("ASK_ENABLE_TOOLS", "true").lower() == "true"
    # Gates the outbound-network tools (research_web / fetch_url) independently of the
    # zero-cost local tools (notes/maps/compute) — flip on after watching cost.
    ENABLE_WEB_TOOLS: bool = os.getenv("ENABLE_WEB_TOOLS", "false").lower() == "true"
    # Dynamic-loop bounds (cost/latency control). On exhaustion the orchestrator is forced
    # to answer with no tools, so the user always gets a reply — never an error.
    MAX_ORCH_ROUNDS: int = int(os.getenv("MAX_ORCH_ROUNDS", "4"))
    MAX_TOOL_CALLS_PER_ASK: int = int(os.getenv("MAX_TOOL_CALLS_PER_ASK", "8"))
    MAX_SUBAGENT_CALLS_PER_ASK: int = int(os.getenv("MAX_SUBAGENT_CALLS_PER_ASK", "4"))
    # Truncate each tool/subagent result before feeding it back to the model (stops a
    # fetched page or huge note set from exploding context cost).
    TOOL_RESULT_MAX_CHARS: int = int(os.getenv("TOOL_RESULT_MAX_CHARS", "8000"))
    # Deep async tasks (heavy multi-note jobs run on the Cloud Tasks worker, not inline):
    # bigger budgets than an interactive ask, plus their own daily per-user cap.
    DEEP_MAX_ROUNDS: int = int(os.getenv("DEEP_MAX_ROUNDS", "8"))
    DEEP_MAX_NOTES: int = int(os.getenv("DEEP_MAX_NOTES", "40"))
    MAX_DEEP_TASKS_PER_USER_PER_DAY: int = int(os.getenv("MAX_DEEP_TASKS_PER_USER_PER_DAY", "5"))
    # Global daily kill-switch on deep tasks — the most expensive path (multi-round, 40 notes).
    # Without it a per-user cap alone leaves total spend unbounded as users scale; this protects
    # the budget the same way DAILY_GLOBAL_ASK_CAP does for interactive asks.
    DAILY_GLOBAL_DEEP_CAP: int = int(os.getenv("DAILY_GLOBAL_DEEP_CAP", "50"))
    # Persistent chat history (cross-session conversations).
    # Cap: oldest conversations are pruned when the user exceeds this limit.
    # TTL: conversations not updated within this many days are auto-deleted.
    MAX_CONVERSATIONS_PER_USER: int = int(os.getenv("MAX_CONVERSATIONS_PER_USER", "20"))
    MAX_CONVERSATION_MESSAGES: int = int(os.getenv("MAX_CONVERSATION_MESSAGES", "100"))
    CONVERSATION_TTL_DAYS: int = int(os.getenv("CONVERSATION_TTL_DAYS", "30"))

    # Direct-URI video analysis cap. YouTube videos longer than this fall back to the
    # transcript path instead of being sent to Gemini whole.
    MAX_VIDEO_SECONDS: int = int(os.getenv("MAX_VIDEO_SECONDS", "1800"))  # 30 min

    # Max size for downloaded social media files we upload to GCS for analysis.
    MAX_MEDIA_DOWNLOAD_MB: int = int(os.getenv("MAX_MEDIA_DOWNLOAD_MB", "100"))

    # Direct user uploads (screenshot / image / PDF / voice via /api/ingest/upload).
    # A per-input ceiling bounds both the GCS object and the Gemini token cost of a single
    # capture — the cheapest safe equivalent of a page cap for PDFs (we don't parse pages).
    MAX_UPLOAD_MB: int = int(os.getenv("MAX_UPLOAD_MB", "20"))
    # Video is its own (larger) ceiling — a clip is far bigger than a screenshot, but the
    # cap still bounds a single capture's Gemini token cost (analyzed at low media resolution).
    MAX_VIDEO_UPLOAD_MB: int = int(os.getenv("MAX_VIDEO_UPLOAD_MB", "100"))
    ALLOWED_UPLOAD_MIME: dict[str, set[str]] = {
        "image": {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"},
        "pdf": {"application/pdf"},
        "voice": {"audio/mpeg", "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac",
                  "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"},
        "video": {"video/mp4", "video/quicktime", "video/webm", "video/x-matroska",
                  "video/x-msvideo", "video/mpeg", "video/3gpp"},
    }

    # Optional paid fallback for Instagram/TikTok when yt-dlp is IP-blocked from Cloud Run
    # (datacenter IPs hit a login/rate-limit wall cookie-less). Apify owns the proxies +
    # accounts; we pay per scrape. Dormant until APIFY_TOKEN is set — the og-caption
    # fallback covers the no-token case. Metered cost line, like Imagen.
    APIFY_TOKEN: str = os.getenv("APIFY_TOKEN", "")
    # Per-platform actors (built + maintained by Apify/clockworks). Each is env-overridable
    # so you can swap an actor without a redeploy. API paths use `~`, not `/`, between the
    # owner and actor name (e.g. apify~instagram-post-scraper) — store URLs use `/`.
    APIFY_INSTAGRAM_REEL_ACTOR: str = os.getenv("APIFY_INSTAGRAM_REEL_ACTOR", "apify~instagram-reel-scraper")
    APIFY_INSTAGRAM_POST_ACTOR: str = os.getenv("APIFY_INSTAGRAM_POST_ACTOR", "apify~instagram-post-scraper")
    APIFY_TIKTOK_ACTOR: str = os.getenv("APIFY_TIKTOK_ACTOR", "clockworks~tiktok-scraper")
    # Facebook is opt-in (empty = off → FB uses the free og-caption path). The official
    # apify~facebook-reels-scraper is page-based (can't target one reel); to enable single
    # reel/video scraping, set this to a single-URL actor that takes `startUrls`, e.g.
    # "neuro-scraper~facebook-video-details-scraper". Community-maintained, so opt-in.
    APIFY_FACEBOOK_ACTOR: str = os.getenv("APIFY_FACEBOOK_ACTOR", "")
    # YouTube is a FALLBACK only — Gemini analyzes most YouTube URLs directly (youtube.py,
    # free, no download). This actor is the backstop for the rare video Gemini can't fetch
    # (private/age/region-gated); invoked from the extraction-failure path, not the resolver.
    APIFY_YOUTUBE_ACTOR: str = os.getenv("APIFY_YOUTUBE_ACTOR", "streamers~youtube-scraper")
    # Hard ceiling so a runaway/abuse spike can't drain the budget via paid scrapes.
    APIFY_DAILY_GLOBAL_CAP: int = int(os.getenv("APIFY_DAILY_GLOBAL_CAP", "200"))

    # --- Watchlist mini-app (TMDB enrichment) ---
    # TMDB v4 Read Access Token (sent as `Authorization: Bearer`). When empty, enrichment is a
    # graceful no-op: entertainment notes still save and their titles render unenriched.
    # TMDB is free for this use, so no per-user cost cap (unlike Gemini/Imagen).
    TMDB_BEARER: str = os.getenv("TMDB_BEARER", "")
    TMDB_API_BASE: str = os.getenv("TMDB_API_BASE", "https://api.themoviedb.org/3")
    TMDB_IMAGE_BASE: str = os.getenv("TMDB_IMAGE_BASE", "https://image.tmdb.org/t/p")
    # Region (ISO-3166-1 alpha-2) used for "where to watch" when a user has none set.
    DEFAULT_WATCH_REGION: str = os.getenv("DEFAULT_WATCH_REGION", "IN")
    # Provider lookups cache per (tmdb_id, region) for this many hours (JustWatch data lags ~8h).
    TMDB_PROVIDER_CACHE_HOURS: int = int(os.getenv("TMDB_PROVIDER_CACHE_HOURS", "24"))
    # Full title details (cast/runtime/rating) cache for this many hours — they change rarely.
    TMDB_DETAIL_CACHE_HOURS: int = int(os.getenv("TMDB_DETAIL_CACHE_HOURS", "168"))

    # --- Places mini-app (Google Places API New) ---
    # Server-side calls authenticate with the runtime service account (ADC) — same as Vertex /
    # Firestore — so there's no API key to manage. Off → enrichment is a graceful no-op: place
    # notes still save and their venues render from the raw venue name. Cache hard + the free SKU
    # tier keep cost negligible. (The frontend Maps JS uses a separate browser key.)
    ENABLE_PLACES: bool = os.getenv("ENABLE_PLACES", "true").lower() == "true"
    GOOGLE_PLACES_API_BASE: str = os.getenv("GOOGLE_PLACES_API_BASE", "https://places.googleapis.com/v1")
    # Place search/details results cache for this many hours — they change rarely.
    PLACES_DETAIL_CACHE_HOURS: int = int(os.getenv("PLACES_DETAIL_CACHE_HOURS", "168"))

    # --- Trips mini-app (itinerary fan-out) ---
    # Itinerary stops carry no coords, so the trip fan-out geocodes each stop by name via the same
    # Google Places Text Search (cached, ADC; a no-op when ENABLE_PLACES is off). Cap the geocodes
    # per trip so a pathological many-stop itinerary can't run up the bill — stops past the cap keep
    # their text and are simply absent from the detail map.
    TRIP_MAX_GEOCODED_STOPS: int = int(os.getenv("TRIP_MAX_GEOCODED_STOPS", "40"))

    # Optional Firecrawl API key for bot-protected product pages (tier 2 fallback).
    FIRECRAWL_API_KEY: str = os.getenv("FIRECRAWL_API_KEY", "")
    # Optional Jina Reader key (r.jina.ai works keyless at low volume; key raises limits).
    JINA_API_KEY: str = os.getenv("JINA_API_KEY", "")

    # AI-generated covers (Imagen). Off by default — a real cost line. When on, a note
    # that would otherwise be coverless gets one generated image (the frontend gradient
    # hero is the fallback when off / failed / capped). Daily caps mirror the note caps;
    # price is USD per generated image (verify against live Vertex pricing before enabling).
    ENABLE_IMAGEN: bool = os.getenv("ENABLE_IMAGEN", "false").lower() == "true"
    VISUAL_CONTENT_TYPES: set[str] = {"recipe", "product", "itinerary", "travel", "place", "fashion", "workout"}
    MAX_IMAGES_PER_USER_PER_DAY: int = int(os.getenv("MAX_IMAGES_PER_USER_PER_DAY", "20"))
    DAILY_GLOBAL_IMAGE_CAP: int = int(os.getenv("DAILY_GLOBAL_IMAGE_CAP", "200"))
    IMAGEN_PRICE_PER_IMAGE: float = float(os.getenv("IMAGEN_PRICE_PER_IMAGE", "0.04"))

    # --- Admin dashboard ---
    # Emails allowed to read /api/admin/stats (comma-separated). Gating is by verified
    # Firebase email, not uid, so it's set-and-forget across re-signups. NO baked-in
    # default: unset ⇒ empty set ⇒ admin is fully closed. Set ADMIN_EMAILS on Cloud Run.
    ADMIN_EMAILS: set[str] = {
        e.strip().lower()
        for e in os.getenv("ADMIN_EMAILS", "").split(",")
        if e.strip()
    }

    # Vertex AI Gemini token pricing, USD per 1,000,000 tokens. We store raw token
    # counts (immutable facts) and derive cost at read-time from these, so a price
    # change re-prices history correctly. Paid-tier Standard rates (confirmed against
    # the live pricing page, 2026-06-12); output includes thinking tokens. Lite input
    # uses the text/image/video rate ($0.25).
    # TODO(voice): voice notes now DO send audio to Gemini, which bills at the higher audio
    # input rate (~2× text). The usage meter still prices all input at the text rate, so
    # voice-note cost is under-reported — split the input rate by modality when metering.
    GEMINI_PRICE_IN: float = float(os.getenv("GEMINI_PRICE_IN", "1.50"))
    GEMINI_PRICE_OUT: float = float(os.getenv("GEMINI_PRICE_OUT", "9.00"))
    GEMINI_LITE_PRICE_IN: float = float(os.getenv("GEMINI_LITE_PRICE_IN", "0.25"))
    GEMINI_LITE_PRICE_OUT: float = float(os.getenv("GEMINI_LITE_PRICE_OUT", "1.50"))
    # text-embedding-005 on Vertex AI: ~$0.025/1M tokens (input only; no output).
    EMBED_PRICE_IN: float = float(os.getenv("EMBED_PRICE_IN", "0.025"))
    USD_TO_INR: float = float(os.getenv("USD_TO_INR", "84.0"))


settings = Settings()
