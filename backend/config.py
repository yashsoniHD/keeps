import os
from dotenv import load_dotenv

load_dotenv()

# Vercel has no ADC: the service-account key arrives as a JSON env var. Write it to a 0600 file
# and point Google's client libraries (firebase-admin, Firestore, google.auth) at it. Skipped
# when unset (local ADC, tests).
if os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON"):
    _fd = os.open("/tmp/sa.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(_fd, "w") as _f:
        _f.write(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/tmp/sa.json"


def _chain(name: str, default: str) -> list[str]:
    return [m.strip() for m in os.getenv(name, default).split(",") if m.strip()]


class Settings:
    PROJECT_NAME = "Clip Note API"
    VERSION = "1.0.0"

    GOOGLE_CLOUD_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "weekly-updates-automation")

    # --- AI via OpenRouter (OpenAI-compatible API). Model ids verified against the live
    # catalog (GET https://openrouter.ai/api/v1/models) on 2026-10-03.
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    # Model chains: comma-separated, tried in order inside ONE request via OpenRouter's `models`
    # fallback (429 / 5xx / downtime) — free endpoint first, paid floor last.
    # Paid-only: in the spike the free nemotron omni was 5-7x slower (46-157 s), hit worker
    # request limits on parallel calls and rejects bodies > 25 MiB.
    VIDEO_MODELS: list[str] = _chain("VIDEO_MODELS", "google/gemini-2.5-flash-lite")
    # YouTube URLs: pinned to the Google AI Studio provider (the only one that fetches the URL).
    YOUTUBE_MODELS: list[str] = _chain("YOUTUBE_MODELS", "google/gemini-2.5-flash-lite")
    # Images/carousels: Gemini too. In the 2026-10 A/B gemma-4:free 429'd on every call and the
    # paid ling-3.0-flash-vl fallback rejects >4 images ("6 > 4"), so all 3 carousels failed.
    IMAGE_MODELS: list[str] = _chain("IMAGE_MODELS", "google/gemini-2.5-flash-lite")
    # Text/classify are paid-only: in the 2026-10 A/B nemotron-3-super:free fabricated fields
    # on caption-only notes and gemma-4:free 429'd on 7/7 classify calls.
    TEXT_MODELS: list[str] = _chain("TEXT_MODELS", "deepseek/deepseek-v3.2")
    CLASSIFY_MODELS: list[str] = _chain("CLASSIFY_MODELS", "qwen/qwen3-30b-a3b-instruct-2507")
    # Hard client timeout on one video call, well inside JOB_DEADLINE_S; on timeout the call is
    # retried once on the rest of the chain (OpenRouter's own fallback never sees a client abort).
    VIDEO_CALL_TIMEOUT_S: int = int(os.getenv("VIDEO_CALL_TIMEOUT_S", "120"))
    # Note-search embeddings. The vector index dimension in infra MUST match EMBED_DIM exactly.
    EMBED_MODEL: str = os.getenv("EMBED_MODEL", "qwen/qwen3-embedding-8b")
    EMBED_DIM: int = int(os.getenv("EMBED_DIM", "768"))
    # Top-K notes returned by a semantic search.
    SEARCH_LIMIT: int = int(os.getenv("SEARCH_LIMIT", "20"))
    # Per-user daily cap on /api/search — each search embeds the query (a paid embedding call,
    # tiny but previously unbounded). Generous: real usage is a handful of searches a day.
    MAX_SEARCHES_PER_USER_PER_DAY: int = int(os.getenv("MAX_SEARCHES_PER_USER_PER_DAY", "500"))
    # Self-dispatch to the worker route (replaces Cloud Tasks). WORKER_SECRET authenticates
    # /api/process; CRON_SECRET is the Vercel cron bearer for the sweep route.
    WORKER_URL: str = os.getenv("WORKER_URL", "")
    WORKER_SECRET: str = os.getenv("WORKER_SECRET", "")
    CRON_SECRET: str = os.getenv("CRON_SECRET", "")

    TEMP_DOWNLOAD_DIR: str = os.getenv("TEMP_DOWNLOAD_DIR", "/tmp/clip_note_downloads")

    # Cost guardrails (budget ~$360 total).
    MAX_NOTES_PER_USER: int = int(os.getenv("MAX_NOTES_PER_USER", "500"))
    MAX_INGESTS_PER_USER_PER_DAY: int = int(os.getenv("MAX_INGESTS_PER_USER_PER_DAY", "50"))
    DAILY_GLOBAL_NOTE_CAP: int = int(os.getenv("DAILY_GLOBAL_NOTE_CAP", "1000"))
    # Ceiling on a user's content_type taxonomy. Categories are AI-invented and append-only,
    # so without a cap the classifier keeps minting near-duplicates ("idli-dosa" beside
    # "recipe") until the feed's filter chips are unusable. At/over the cap the classifier MUST
    # reuse an existing slug (enforced in prompt AND in code — a net-new slug is snapped to the
    # closest existing category, never appended). Users can still prune/merge below the cap.
    MAX_USER_CATEGORIES: int = int(os.getenv("MAX_USER_CATEGORIES", "15"))
    # Per-IP flood guard on the expensive POST endpoints (ingest). In-memory, per
    # serverless instance — abuse protection layered in front of the authoritative cost caps above.
    RATE_LIMIT_PER_MIN: int = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))


    # Each note's `data` is truncated to this many characters when building the note's search
    # embedding (title + summary + flattened data), so search matches a note's actual content.
    EMBED_NOTE_DATA_EXCERPT_CHARS: int = int(os.getenv("EMBED_NOTE_DATA_EXCERPT_CHARS", "6000"))



    # Reel/YouTube-fallback video file sent to the video model (one ≤360p mp4, base64 in the body).
    # A bigger download (≤60 MB) is re-encoded down to this; anything larger is never fetched.
    VIDEO_MAX_BYTES: int = int(os.getenv("VIDEO_MAX_BYTES", "25000000"))
    # Longest video FILE (reel/TikTok/FB/YouTube-fallback mp4) we download and send to the video
    # model; longer → caption-only thin note, checked from metadata before any download.
    MAX_VIDEO_SECONDS: int = int(os.getenv("MAX_VIDEO_SECONDS", "600"))
    # Longest YouTube video the model watches by URL (Gemini ≈ $0.002/min of video and ≈ 8 s of
    # latency per minute, so 15 min ≈ 120 s = VIDEO_CALL_TIMEOUT_S; an 11-min video took 88 s,
    # a 31-min one timed out); longer → the fallback scraper (captions/subtitles/description).
    YOUTUBE_MAX_DIRECT_SECONDS: int = int(os.getenv("YOUTUBE_MAX_DIRECT_SECONDS", "900"))

    # Optional paid fallback for Instagram/TikTok when yt-dlp is IP-blocked from Vercel
    # (datacenter IPs hit a login/rate-limit wall cookie-less). Apify owns the proxies +
    # accounts; we pay per scrape. Dormant until APIFY_TOKEN is set — the og-caption
    # fallback covers the no-token case. Metered cost line.
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
    APIFY_DAILY_GLOBAL_CAP: int = int(os.getenv("APIFY_DAILY_GLOBAL_CAP", "50"))

    # --- TMDB enrichment (entertainment notes) ---
    # TMDB v4 Read Access Token (sent as `Authorization: Bearer`). When empty, enrichment is a
    # graceful no-op: entertainment notes still save and their titles render unenriched.
    # TMDB is free for this use, so no per-user cost cap (unlike the AI calls).
    TMDB_BEARER: str = os.getenv("TMDB_BEARER", "")
    TMDB_API_BASE: str = os.getenv("TMDB_API_BASE", "https://api.themoviedb.org/3")
    TMDB_IMAGE_BASE: str = os.getenv("TMDB_IMAGE_BASE", "https://image.tmdb.org/t/p")
    # Region (ISO-3166-1 alpha-2) used for "where to watch" when a user has none set.
    DEFAULT_WATCH_REGION: str = os.getenv("DEFAULT_WATCH_REGION", "IN")
    # Provider lookups cache per (tmdb_id, region) for this many hours (JustWatch data lags ~8h).
    TMDB_PROVIDER_CACHE_HOURS: int = int(os.getenv("TMDB_PROVIDER_CACHE_HOURS", "24"))
    # Full title details (cast/runtime/rating) cache for this many hours — they change rarely.
    TMDB_DETAIL_CACHE_HOURS: int = int(os.getenv("TMDB_DETAIL_CACHE_HOURS", "168"))



    # Optional Jina Reader key (r.jina.ai works keyless at low volume; key raises limits).
    JINA_API_KEY: str = os.getenv("JINA_API_KEY", "")


    # Fallback pricing, USD per 1,000,000 tokens — only when a response carries no OpenRouter
    # `usage.cost`. `:free` models cost 0; every other chat model is priced at the paid text
    # floor (deepseek-v3.2 $0.28/$0.42); embed = EMBED_MODEL (qwen3-embedding-8b, input only).
    PRICE_MAIN_IN: float = float(os.getenv("PRICE_MAIN_IN", "0.28"))
    PRICE_MAIN_OUT: float = float(os.getenv("PRICE_MAIN_OUT", "0.42"))
    PRICE_EMBED_IN: float = float(os.getenv("PRICE_EMBED_IN", "0.01"))


settings = Settings()
