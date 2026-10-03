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


class Settings:
    PROJECT_NAME = "Clip Note API"
    VERSION = "1.0.0"

    GOOGLE_CLOUD_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "weekly-updates-automation")
    GOOGLE_CLOUD_LOCATION: str = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    # --- AI via OpenRouter (OpenAI-compatible API). Model ids verified against the live
    # catalog (GET https://openrouter.ai/api/v1/models) on 2026-10-03.
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    # extraction (text/structured), ask answers/synthesis/create, digests, agent orchestrator
    TEXT_MODEL: str = os.getenv("TEXT_MODEL", "deepseek/deepseek-v3.2")
    # classify, plan_ask, backfill helpers, collection-query expansion (text-only model)
    LITE_MODEL: str = os.getenv("LITE_MODEL", "qwen/qwen3-30b-a3b-instruct-2507")
    # carousel images / video frames
    VISION_MODEL: str = os.getenv("VISION_MODEL", "qwen/qwen3-vl-30b-a3b-instruct")
    # YouTube URL direct analysis — pinned to the Google AI Studio provider (accepts YouTube URLs)
    YOUTUBE_MODEL: str = os.getenv("YOUTUBE_MODEL", "google/gemini-2.5-flash-lite")
    # reel audio -> transcript (tier 2 of the reel cascade); OpenRouter /audio/transcriptions
    TRANSCRIBE_MODEL: str = os.getenv("TRANSCRIBE_MODEL", "openai/whisper-large-v3-turbo")
    # Note-search embeddings. The vector index dimension in infra MUST match EMBED_DIM exactly.
    EMBED_MODEL: str = os.getenv("EMBED_MODEL", "qwen/qwen3-embedding-8b")
    EMBED_DIM: int = int(os.getenv("EMBED_DIM", "768"))
    # Top-K notes returned by a semantic search.
    SEARCH_LIMIT: int = int(os.getenv("SEARCH_LIMIT", "20"))
    # Per-user daily cap on /api/search — each search embeds the query (a paid Vertex call,
    # tiny but previously unbounded). Generous: real usage is a handful of searches a day.
    MAX_SEARCHES_PER_USER_PER_DAY: int = int(os.getenv("MAX_SEARCHES_PER_USER_PER_DAY", "500"))
    # Self-dispatch to the worker route (replaces Cloud Tasks). WORKER_SECRET authenticates
    # /api/process; CRON_SECRET is the Vercel cron bearer for the sweep route.
    WORKER_URL: str = os.getenv("WORKER_URL", "")
    WORKER_SECRET: str = os.getenv("WORKER_SECRET", "")
    CRON_SECRET: str = os.getenv("CRON_SECRET", "")

    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "https://clipnote.web.app")

    # Public-facing app origin — used to build shareable note links (/p/{id}).
    PUBLIC_APP_URL: str = os.getenv("PUBLIC_APP_URL", "https://clipnote.web.app")

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

    # --- Smart collections (hybrid multi-membership rescore) ---
    # How many nearest notes to consider when a collection is (re)scored, and the max COSINE
    # distance (1 - similarity) to still count as a match. Tuned for precision over recall —
    # a missed note can always be pinned manually, a wrong one is annoying. K bumped from 50 to
    # 200 now that rescoring can both add AND remove membership across a user's whole corpus,
    # not just sweep unassigned notes.
    COLLECTION_BACKFILL_K: int = int(os.getenv("COLLECTION_BACKFILL_K", "200"))
    COLLECTION_BACKFILL_MAX_DISTANCE: float = float(
        os.getenv("COLLECTION_BACKFILL_MAX_DISTANCE", "0.45"))
    # Name+description shorter than this is too thin to embed well ("AI") — expand it into a
    # descriptive query via one lite-model call before the vector sweep.
    COLLECTION_QUERY_EXPAND_BELOW: int = int(os.getenv("COLLECTION_QUERY_EXPAND_BELOW", "48"))
    # Cosine-similarity floor for a note to belong to a collection (the multi-membership
    # matcher). Derived from the distance threshold above by default (similarity = 1 - distance)
    # so the two stay in lockstep unless explicitly overridden; a collection can still set its
    # own per-collection `match_threshold` that takes priority over this default.
    COLLECTION_MATCH_MIN_SIMILARITY: float = float(
        os.getenv("COLLECTION_MATCH_MIN_SIMILARITY", str(1 - COLLECTION_BACKFILL_MAX_DISTANCE)))
    # Ceiling on how many collections a user may have when they next hit /rescore. Collections
    # are created directly by the client in Firestore (no backend create path), so this is NOT
    # enforced at creation — `routers/collections.py`'s `/rescore` endpoint is the one place that
    # checks it (a user over the cap is told to delete some before rescoring again). Exists so an
    # unbounded collection count can't make rescoring unbounded cost/latency too.
    MAX_COLLECTIONS_PER_USER: int = int(os.getenv("MAX_COLLECTIONS_PER_USER", "30"))
    # Per-collection daily cap on manual/triggered rescores — each rescore is a query-embed
    # (paid Vertex call) plus a vector sweep, so repeats are capped like the mini-app backfills.
    MAX_RESCORES_PER_COLLECTION_PER_DAY: int = int(
        os.getenv("MAX_RESCORES_PER_COLLECTION_PER_DAY", "5"))

    # --- Collection digests (cached, composed "digest" per smart collection) ---
    # How many of a collection's most-recent member notes get fed to the digest builder — bounds
    # token cost the same way ASK_EXHAUSTIVE_CAP does for asks.
    DIGEST_MAX_NOTES: int = int(os.getenv("DIGEST_MAX_NOTES", "30"))
    # Each note's `data` is truncated to this many characters in the digest prompt (mirrors the
    # per-note data excerpt in the ask/synthesize prompts, just its own knob). The digest is
    # built by READING `data` (listicle entries, tool names, step breakdowns, etc), not just the
    # note's title/summary, so this needs real headroom — verified against live production notes
    # (2026-07-12): a 17-step agency-stack breakdown and a 4-prompt PM playbook both serialize
    # past 3000 chars, which was silently truncating exactly the content the digest needs to
    # synthesize. 6000 covers every note observed in that pass with headroom to spare.
    DIGEST_NOTE_DATA_EXCERPT_CHARS: int = int(os.getenv("DIGEST_NOTE_DATA_EXCERPT_CHARS", "6000"))
    # Each note's `data` is truncated to this many characters when building the note's search
    # embedding (title + summary + flattened data). Mirrors the digest excerpt knob so search can
    # match a note's actual content, not just its title/summary.
    EMBED_NOTE_DATA_EXCERPT_CHARS: int = int(os.getenv("EMBED_NOTE_DATA_EXCERPT_CHARS", "6000"))
    # Bumped whenever DIGEST_SYSTEM changes meaningfully (prompt behavior, not just wording) so
    # digests cached under an older prompt are treated as stale and rebuilt automatically, even
    # when membership (source_note_ids) hasn't changed. Stored on the digest map as
    # `prompt_version`; routers/collections.py's staleness check treats a missing or lower value
    # as stale.
    # v3 (2026-07-12): v1 listed note titles, v2 still echoed title+summary as entries instead of
    # reading `data` — replaced the items-only schema with heading+body synthesis prose per
    # section (DigestSection.body) so a section reads like someone who read the notes wrote it,
    # not like an index into them. See services/gemini.py DIGEST_SYSTEM.
    DIGEST_PROMPT_VERSION: int = 3
    # A digest (re)build is a paid Gemini call over up to DIGEST_MAX_NOTES notes at once, so
    # repeats are capped like rescores — per collection, per user, and a global kill-switch.
    MAX_DIGEST_REGENS_PER_COLLECTION_PER_DAY: int = int(
        os.getenv("MAX_DIGEST_REGENS_PER_COLLECTION_PER_DAY", "3"))
    MAX_DIGEST_REGENS_PER_USER_PER_DAY: int = int(
        os.getenv("MAX_DIGEST_REGENS_PER_USER_PER_DAY", "15"))
    DAILY_GLOBAL_DIGEST_CAP: int = int(os.getenv("DAILY_GLOBAL_DIGEST_CAP", "50"))

    # --- Personal (my) digest: the in-app week-in-review at /api/digest/me ---
    # Bumped whenever PERSONAL_DIGEST_SYSTEM changes meaningfully so a digest cached under an
    # older prompt is treated as stale and rebuilt on next view, even when the fed note set
    # hasn't changed. Stored on users/{uid}.digest as `prompt_version`.
    PERSONAL_DIGEST_PROMPT_VERSION: int = 1
    # Minimum notes saved in the last 7 days for the digest to be built over the WEEK; below this
    # the digest falls back to the user's newest MY_DIGEST_FALLBACK_NOTES saves instead (so a
    # sparse week still gets a useful review rather than nothing).
    MY_DIGEST_MIN_WEEK_NOTES: int = int(os.getenv("MY_DIGEST_MIN_WEEK_NOTES", "3"))
    MY_DIGEST_FALLBACK_NOTES: int = int(os.getenv("MY_DIGEST_FALLBACK_NOTES", "10"))
    # A personal-digest (re)build is a paid Gemini call over up to DIGEST_MAX_NOTES notes, so
    # repeats are capped per user and against a global daily kill-switch (same shape as the
    # collection digest caps, minus the per-collection tier).
    MAX_MY_DIGEST_BUILDS_PER_USER_PER_DAY: int = int(
        os.getenv("MAX_MY_DIGEST_BUILDS_PER_USER_PER_DAY", "5"))
    DAILY_GLOBAL_MY_DIGEST_CAP: int = int(os.getenv("DAILY_GLOBAL_MY_DIGEST_CAP", "75"))

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

    # YouTube direct-URL analysis cap: longer videos without a transcript go to Apify subtitles
    # / description-only instead of being sent to the model whole.
    MAX_VIDEO_SECONDS: int = int(os.getenv("MAX_VIDEO_SECONDS", "900"))  # 15 min

    # Max size of a downloaded social media file (local temp only).
    MAX_MEDIA_DOWNLOAD_MB: int = int(os.getenv("MAX_MEDIA_DOWNLOAD_MB", "25"))

    # Optional paid fallback for Instagram/TikTok when yt-dlp is IP-blocked from Cloud Run
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

    # --- Watchlist mini-app (TMDB enrichment) ---
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

    # --- Places mini-app (Google Places API New) ---
    # Server-side calls authenticate with the runtime service account (ADC) — same as Vertex /
    # Firestore — so there's no API key to manage. Off → enrichment is a graceful no-op: place
    # notes still save and their venues render from the raw venue name. Cache hard + the free SKU
    # tier keep cost negligible. (The frontend Maps JS uses a separate browser key.)
    ENABLE_PLACES: bool = os.getenv("ENABLE_PLACES", "true").lower() == "true"
    GOOGLE_PLACES_API_BASE: str = os.getenv("GOOGLE_PLACES_API_BASE", "https://places.googleapis.com/v1")
    # Place search/details results cache for this many hours — they change rarely.
    PLACES_DETAIL_CACHE_HOURS: int = int(os.getenv("PLACES_DETAIL_CACHE_HOURS", "168"))
    # Cap Places enrichment per note (a long listicle) so a pathological 30-venue list can't run
    # up the bill — the first N venues get photos/ratings/coords; the rest keep their extracted
    # text and are simply un-enriched. Mirrors TRIP_MAX_GEOCODED_STOPS.
    PLACES_MAX_ENRICHED_VENUES: int = int(os.getenv("PLACES_MAX_ENRICHED_VENUES", "15"))

    # --- Trips mini-app (itinerary fan-out) ---
    # Itinerary stops carry no coords, so the trip fan-out geocodes each stop by name via the same
    # Google Places Text Search (cached, ADC; a no-op when ENABLE_PLACES is off). Cap the geocodes
    # per trip so a pathological many-stop itinerary can't run up the bill — stops past the cap keep
    # their text and are simply absent from the detail map.
    TRIP_MAX_GEOCODED_STOPS: int = int(os.getenv("TRIP_MAX_GEOCODED_STOPS", "40"))

    # Optional Jina Reader key (r.jina.ai works keyless at low volume; key raises limits).
    JINA_API_KEY: str = os.getenv("JINA_API_KEY", "")

    # --- Admin dashboard ---
    # Emails allowed to read /api/admin/stats (comma-separated). Gating is by verified
    # Firebase email, not uid, so it's set-and-forget across re-signups. NO baked-in
    # default: unset ⇒ empty set ⇒ admin is fully closed. Set ADMIN_EMAILS on Cloud Run.
    ADMIN_EMAILS: set[str] = {
        e.strip().lower()
        for e in os.getenv("ADMIN_EMAILS", "").split(",")
        if e.strip()
    }

    # Fallback token pricing, USD per 1,000,000 tokens — used only when a response carries no
    # OpenRouter `usage.cost` (and for pre-cutover token counters). Main = TEXT/VISION/YOUTUBE
    # models (priced at TEXT_MODEL rates), lite = LITE_MODEL, embed = EMBED_MODEL (input only).
    # Live catalog rates 2026-10-03: deepseek-v3.2 $0.28/$0.42, qwen3-30b-a3b-instruct-2507
    # $0.048/$0.193, qwen3-embedding-8b $0.01.
    PRICE_MAIN_IN: float = float(os.getenv("PRICE_MAIN_IN", "0.28"))
    PRICE_MAIN_OUT: float = float(os.getenv("PRICE_MAIN_OUT", "0.42"))
    PRICE_LITE_IN: float = float(os.getenv("PRICE_LITE_IN", "0.05"))
    PRICE_LITE_OUT: float = float(os.getenv("PRICE_LITE_OUT", "0.20"))
    PRICE_EMBED_IN: float = float(os.getenv("PRICE_EMBED_IN", "0.01"))
    USD_TO_INR: float = float(os.getenv("USD_TO_INR", "84.0"))


settings = Settings()
