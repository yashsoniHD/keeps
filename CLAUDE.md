# Clip Note

Save any URL as a beautifully structured note. Paste a link — the app scrapes or downloads the content, sends it through Gemini, and produces a richly structured note with a cover image. Note types are AI-determined and open-ended; new categories emerge automatically.

---

## Product Focus

**Primary use case (MVP wedge):** turn saved links into notes worth *re-reading* — the value is not
in capturing, it's in the structured note being better than the source and easy to come back to.

**Target user:** someone who already saves links constantly (recipes, articles, products, travel)
and loses them in a graveyard of tabs/bookmarks they never reopen.

**Retention hook:** a genuinely real-time feed (MVP), then weekly digest email (Phase 3) and
full-text search (Phase 4). The capture flow is the easy part; *coming back* is the product.

**Phased build order (binding — see the plan doc):** the work is sequenced so the core bet,
monetization, retention, and growth each get de-risked in turn:

| Phase | What | Gate |
|-------|------|------|
| 0 | Validate AI output on 20–30 real URLs | Blocks everything |
| 1 | Core backend + frontend | Working capture-to-note |
| 2 | PWA share target + iOS shortcut/PAT | Capture is a reflex |
| 3 | Paywall + weekly digest email | Before public launch |
| 4 | Typesense search + public notes | First month of usage |
| 5 | Expo native share extension | After web validation |

Hard rules: **don't skip Phase 0; don't launch publicly before Phase 3.**

**Still deferred (post-Phase-5):** resurfacing/reminders, user-owned collections, Android native app,
(Imagen covers dropped — links-only.)

> **Phase 0 is a real gate, not a formality.** Before building, run the extraction on 20–30 real URLs
> (recipes, products, articles, a paywalled article, a captioned video) and judge the output by hand.
> If it isn't clearly better than the source, fix the prompt before writing production code.

---

## Project IDs & Links

| Item | Value |
|------|-------|
| GCP Project ID | `weekly-updates-automation` (shared project — user's choice; Firestore + Firebase Auth were pre-enabled) |
| GCP Region | `us-central1` (legacy infra, being torn down) — Firebase/Firestore only after cutover |
| Firebase Project | `weekly-updates-automation` |
| Backend host | Vercel Hobby container (project to be created in Phase F; root `backend`, `Dockerfile.vercel`). Production URL placeholder `https://clip-note-api-yashsoni102-progs-projects.vercel.app`. Deploy notes: `infra/vercel.md` |
| Job dispatch | Synchronous self-POST to `/api/process/{id}` (`X-Worker-Secret`) + in-process retry + daily cron sweep (`GET /api/process/sweep`) |
| Firebase Hosting URL | https://weekly-updates-automation.web.app |
| Legacy Cloud Run URL | https://clip-note-api-674775099277.us-central1.run.app (rollback only; torn down after soak) |
| Service account | `clip-note-vercel` (`roles/datastore.user`), key supplied as `GOOGLE_SERVICE_ACCOUNT_JSON` (written to `/tmp/sa.json`, exported as `GOOGLE_APPLICATION_CREDENTIALS`) |
| AI provider | OpenRouter (`OPENROUTER_API_KEY`) |
| Firebase web app | "Clip Note" `1:674775099277:web:5a3293c1c0b570e392bfc4` |
| Models | `TEXT_MODEL=deepseek/deepseek-v3.2` (extract/ask/digests) · `LITE_MODEL=qwen/qwen3-30b-a3b-instruct-2507` (classify/plan, text-only) · `VISION_MODEL=qwen/qwen3-vl-30b-a3b-instruct` (frames/carousels) · `YOUTUBE_MODEL=google/gemini-2.5-flash-lite` (YouTube URLs only) · `TRANSCRIBE_MODEL=openai/whisper-large-v3-turbo` (reel audio) · `EMBED_MODEL=qwen/qwen3-embedding-8b` (768-dim). All env-overridable in `backend/config.py`. |
| TMDB (note enrichment) | `TMDB_BEARER` env on Vercel = TMDB v4 Read Access Token. Empty = enrichment no-op. Free API; "Streaming data by JustWatch" credit is mandatory wherever providers render. |
| Billing budget | "Clip Note credits guard" ₹30,000 (50/80/100% alerts) |
| Distill reference app | `/Users/yashsoni/dev/distill` |
| Lovable frontend source | `/Users/yashsoni/Downloads/Clip Note` |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | TanStack Start (React 19, Vite, Tailwind 4, shadcn/ui) | Lovable-designed frontend, kept as-is |
| Auth | Firebase Authentication — Google Sign-In only | Single tap, no passwords, native GCP |
| Database | Firestore | Schema-less — handles AI-invented note types without migrations |
| Backend | FastAPI container on Vercel (Hobby) | Dockerized (ffmpeg + yt-dlp), scale-to-zero, free; 300 s per request |
| Job dispatch | Self-POST worker + in-process retry + daily cron sweep | No queue service; ingest returns job_id fast, worker runs as a real in-flight request |
| AI | OpenRouter — DeepSeek V3.2 (text), Qwen3 lite/vision, Gemini 2.5 Flash Lite (YouTube URLs only), Whisper (reel audio), Qwen3-embedding-8b (768-dim) | Cheap open models by default; Gemini only where it fetches the video itself |
| Hosting | Firebase Hosting | Frontend static export |

---

## Architecture

```
User pastes URL (links only; typed text notes also allowed — no file/voice uploads)
  → POST /api/ingest (Firebase ID token; URL canonicalized via services/url_utils.py)
  → Write Firestore: jobs/{job_id} {status: "pending"}
  → services/dispatch.py: POST self /api/process/{job_id} with X-Worker-Secret, 1.5 s read timeout = "accepted"
  → Return {job_id}

[/api/process/{job_id}]  (X-Worker-Secret; idempotent claim — duplicates 409, completed = no-op; budget JOB_DEADLINE_S=270)
  → Update job {status: "processing"}
  → Resolve source (services/sources/): YouTube → transcript-first / direct URL; reels → tier cascade;
    web → JSON-LD-first scrape; transient failure → in-process retry (5 s, 10 s) inside the budget
  → Completeness gate may escalate reel tiers (never rejects a note)
  → Cover: hot-linked og:image / thumbnail / first <img> / enrichment poster → frontend gradient hero (nothing persisted)
  → OpenRouter → {content_type, title, ai_summary, data{}}   (structured data only — no HTML)
  → Write Firestore: notes/{note_id}
  → Update job {status: "completed", note_id}

[Vercel cron, daily] GET /api/process/sweep → re-dispatch stale pending/processing jobs (and drain deferred captures)

[Frontend Firestore onSnapshot on jobs/{job_id}]
  → Note appears automatically, navigate to /notes/{note_id}
```

### Key Architecture Decisions

- **No Supabase** — Firebase Auth + Firestore (kept after the move off Google Cloud; free tier)
- **Dispatch, not a queue** — `services/dispatch.py::enqueue_process_job` self-POSTs the worker (the worker only answers when done, so the 1.5 s read timeout means "accepted"; connect error / 401 / 403 fails the job loudly). `process_job` retries transient failures in-process (5 s, 10 s) and stops at `JOB_DEADLINE_S = 270` (Vercel kills a request at 300 s); an out-of-budget job stays `pending` for the sweep. `GET /api/process/sweep` (daily cron, `Authorization: Bearer CRON_SECRET`) and ingest's per-user stale re-dispatch are the backstops; jobs older than 24 h or with 5 attempts are marked failed. Upgrade path: Vercel Queues + a small Node consumer.
- **Single Vercel container, shared-secret worker auth** — `services/worker_auth.py::verify_worker_secret` checks `X-Worker-Secret` (fails closed when `WORKER_SECRET` is unset; the cron bearer is accepted only on the sweep route). Unset `WORKER_SECRET` locally = inline worker.
- **Structured data, not stored HTML** — the model returns a structured `data` map; React templates render it (`RecipeNote`, `ItineraryNote`, `ProductNote`, `SummaryNote`, and a `GenericNote` fallback for AI-invented types). This keeps the design restylable, cheaper (fewer output tokens), consistent, and free of `dangerouslySetInnerHTML`. **Do not have the model emit HTML.**
- **Dynamic note types** — the model invents `content_type` slugs, matched/normalized against the user's existing `categories` array (`users/{uid}.categories`) — no full-collection scan per ingest; `GenericNote` renders any type without a dedicated template
- **Links-only; Imagen, uploads, voice, GCS removed.** No file/voice/video uploads, no cover persistence, no Imagen, no Cloud Storage. Covers are hot-linked og:image / thumbnail / first `<img>` / enrichment poster; a missing or expired one renders the **frontend gradient + type-icon hero** (`NoteContent.tsx` `CoverHero`). Existing image/pdf/voice notes still render.
- **Reel cascade** (`services/sources/social_video.py`: `acquire` → `escalate` → `cleanup`) — never send whole video. T1 caption + top comments (yt-dlp metadata, one Apify call if thin) → T2 Whisper transcript (one ≤360p ≤25 MB download, ffmpeg mp3, `TRANSCRIBE_MODEL`; <15 words = no speech) → T3 ≤8 frames at 768 px to `VISION_MODEL` → else `private_or_blocked` (job fails, no note). A pure completeness gate in `process.py` (`_is_complete`, `_extract_with_escalation`) escalates only `reel_*` bundles, max 2 escalations, and never rejects a note (keeps the best partial). Strategy names `reel_caption|reel_transcript|reel_frames`; origin in `metadata.via` (`ytdlp|apify|og|oembed`). Escalation is skipped unless `elapsed + tier_cost + 45 < JOB_DEADLINE_S`.
- **YouTube transcript-first** (`sources/youtube.py`) — one watch-page fetch (oEmbed fallback). ≤180 s (Shorts) → `YOUTUBE_MODEL` direct; longer with transcript ≥200 chars → text bundle `youtube_transcript` on `TEXT_MODEL`; longer, no transcript, ≤900 s → `YOUTUBE_MODEL` direct; >900 s → Apify subtitles, else description-only. After two YouTube-model failures, one `TEXT_MODEL` call from title + description.
- **URL canonicalization** — `services/url_utils.py::canonical_url()` (pure, called from `IngestRequest._clean_url`) strips `utm_*`, `fbclid`, `gclid`, `igsh`, `igshid`, `mibextid`, TikTok share params (`si` only on YouTube hosts) and normalizes reel paths; Instagram/FB `/share/` links are resolved in `sources.acquire` (one non-following GET, `metadata["canonical_url"]`).
- **Cost guardrails are mandatory** — per-user daily ingest cap + per-user note cap + a global daily kill-switch counter, enforced in `/api/ingest`; `APIFY_DAILY_GLOBAL_CAP` bounds Apify. OpenRouter spend is metered per call (`usage.cost`, falling back to `PRICE_*` per-tier rates) into `lifetime_cost_usd` / `tok_cost_usd`. Keep the GCP billing budget as a tripwire.

---

## Current State

**Status: Phase 0 passed + Phase 1 deployed (2026-06-10); off-Google-Cloud migration built, cutover pending (2026-10-03)**

The app is live (until cutover): https://weekly-updates-automation.web.app → Cloud Run API → Cloud Tasks worker →
Firestore. Phase 0 validated 20/20 real URLs (report: `phase0/REPORT.md`); the user explicitly
passed the gate.

### Architecture notes that supersede older sections of this file
- **Pre-cutover items below that mention Cloud Run, Cloud Tasks, Vertex/Gemini 3.x, Imagen or GCS describe the legacy deployment** — the Vercel + OpenRouter design in Architecture / Key Architecture Decisions above is current.
- **Source-aware content resolver** (`backend/services/sources/`) replaced the binary
  video-vs-webpage split: YouTube → direct Gemini URL analysis (no download); Instagram/FB/TikTok
  → yt-dlp → GCS → `gs://` URI; Reddit → RSS-first (`.json` is bot-blocked); Amazon/products →
  tiered scrape (mobile UA + JSON-LD + selectors; Firecrawl tier never needed so far); generic
  web → JSON-LD-first scrape.
- **Models:** `gemini-3.5-flash` + `gemini-3.1-flash-lite` on the **`global` endpoint** (3.x 404s
  on us-central1). Gemini 3.x thinks by default — never set tight `max_output_tokens` (thoughts
  consume it and `response.text` comes back None). Vertex requires explicit `mimeType` on
  `FileData` even for YouTube URLs.
- **Anti-generic + anti-fabrication prompts** (`backend/services/gemini.py`): per-type
  `TYPE_PROMPTS` (incl. `workout`), composer building blocks for invented slugs, classifier rules
  (no `general`; discussion threads are never plan-types), hard NEVER-FABRICATE rule.
- **Datacenter-IP findings (verified on deployed worker):** Instagram downloads work cookie-less;
  YouTube's yt-dlp *probe* is bot-blocked → non-fatal, falls back to oEmbed + direct Gemini path.
- **IAM gotcha:** `clip-note-sa` needs `roles/iam.serviceAccountUser` **on itself** to enqueue
  OIDC-signed Cloud Tasks (tokenCreator is not enough). Baked into `infra/setup.sh`.
- Frontend is a **vanilla Vite SPA** (TanStack Start/SSR was stripped for Firebase Hosting);
  templates: Recipe/Itinerary/Product/Summary/**Workout** + GenericNote
  (facts/sections/steps/table/checklist/quotes blocks); open-slug design system in
  `frontend/src/lib/note-meta.ts`.
- **Ask AI is query-aware RAG, not single-shot semantic** (`routers/ask.py` + `services/gemini.py`):
  a lite **planner** (`plan_ask` → `AskPlan`) turns each message into a structured filter set, then
  retrieval is *built from the plan*, not always vector: **temporal** (`period`) → tz-aware
  date-window query (client sends `tz_offset_minutes`; the model emits a *period keyword* and the
  backend does the date math — "today" is the user's local day, not UTC); **exhaustive/aggregate**
  (`content_types`, `exhaustive`) → the full filtered set, not a top-K shortlist; **semantic** →
  planner picks ids from a *recent ∪ vector* candidate pool; **`scope=general`** → a plain
  conversational answer with **no note refs and no citations** (off-notes follow-ups don't get forced
  through notes). Coverage ("Based on N of M") surfaces any cap truncation. Two intents *write* notes:
  `output != prose` → `synthesize` builds a COMPOSER-block **artifact** (itinerary / meal-plan +
  deduped grocery list / comparison / checklist); `intent=create` → `create_note` authors one from the
  whole conversation. Both return an `ArtifactNote` the UI renders via **GenericNote blocks** and saves
  with `POST /api/notes/consolidated` (`template:"composed"` forces the generic renderer; `source:"ai"`,
  `acquisition: ai_consolidated|ai_created`, `source_note_ids`). Caps: planner+answer are 2 Gemini
  calls metered as one ask; `ASK_RECENT_POOL`/`ASK_EXHAUSTIVE_CAP` in config.

### Next (per the phase table)
- [x] Phase 2 (2026-06-10): PWA share target (`/share` route, manifest, SW, icons) + iOS
      shortcut PATs (`cn_<id>.<secret>`, bcrypt; `require_user` accepts Firebase JWT or PAT;
      Settings → "Capture from your phone"). Feed UX: delete, source filter, layout toggle,
      responsive 1–4 col grid.
- [x] Production hardening (2026-06-11, plan: `2026-06-11-production-readiness.md`):
      SSRF guard on every outbound fetch (`backend/services/net_guard.py` — validates each
      redirect hop; BlockedURLError is permanent, no fallback note); PAT lockout (10 failed
      attempts) + 5-token cap; structured JSON logging (`services/logging_setup.py` —
      job_id/user_id/url are queryable Cloud Logging fields); `/api/client-errors` browser
      error sink; Gemini extract retry-once; Firestore PITR + daily backups (30d retention);
      Cloud Tasks max-backoff 600s; Cloud Run max-instances 10; uptime check on /health +
      email alerts (ERROR logs, queue depth >100) → yash@goheydigital.com; storage IAM
      narrowed objectAdmin→objectUser; hosting security headers (**CSP is report-only —
      flip to enforcing after checking violation reports**); frontend: 401 retry w/ token
      refresh, deep-link/share survive login redirect, feed pagination + server-side type
      filter, client error reporting; `backend/tests/` (30 tests) + GitHub Actions CI.
- [x] Admin dashboard (2026-06-12): per-user usage + cost. Gemini token spend metered
      via a request-scoped contextvar meter (`services/usage_meter.py`) — `gemini.py` calls
      `record_usage` after every `generate_content` (output = candidates **+ thoughts**, since
      3.x bills thinking tokens); `flush_usage` writes per-tier lifetime counters to
      `users/{uid}` + global daily to `system/usage-{date}`. `GET /api/admin/stats`
      (`routers/admin.py`, gated to `ADMIN_EMAILS` by **verified Firebase email**) joins
      Firebase Auth identity + Firestore note counts + token counters; cost derived at
      read-time from `GEMINI_PRICE_*` config (raw tokens stored, never $; rates confirmed
      vs live pricing — 3.5-flash $1.50/$9.00, 3.1-flash-lite $0.25/$1.50 per 1M in/out).
      Hidden `/admin` route + Settings link (admin-only). Deployed 2026-06-12 (Cloud Run
      rev 00014-z6n + clipnote.web.app). No IAM grant needed: the runtime SA already has
      `firebaseauth.users.get` via `roles/firebase.sdkAdminServiceAgent`, which is what
      `auth.list_users()` requires.
- [x] Ask AI query-aware RAG (2026-06-14): replaced the single `vector → select → answer` path
      with a **planner-routed** pipeline (temporal / exhaustive / semantic / general) + structured
      **artifacts** (consolidate notes → itinerary/meal-plan/comparison, "Save as note") +
      **create-note-from-chat**. Fixes "summary of today's notes returned random notes" (tz-aware
      date window) and general/off-notes follow-ups still citing notes (general-chat mode). New:
      `AskPlan`/`ArtifactNote` models, `plan_ask`/`answer_chat`/`synthesize`/`create_note` in
      gemini.py, `POST /api/notes/consolidated`, `tz_offset_minutes`, `ASK_RECENT_POOL`/
      `ASK_EXHAUSTIVE_CAP`; 28 new tests (133 total). Deployed (Cloud Run rev 00032-zlr +
      clipnote.web.app). Plan: `~/.claude/plans/think-from-an-average-vivid-knuth.md`. Deferred:
      location-aware retrieval ("restaurants in Bandra") + cross-session chat persistence.
- [x] Notes-first collapse (2026-07-10): removed the 5 mini-apps (routes, walls, item
      subcollections, `/api/{watch,wish,place,recipe,trip}-items` routers, per-app tests) and
      made **every capture a note again**, with TMDB/Places/price enrichment folded into
      `note.data` by the new `services/enrich.py` (see "Notes-first" under Firestore
      Collections). Home = the feed (single `Feed` component, `home` variant adds greeting +
      capture chips + user Collections); search/Ask/nav/citations are notes-only;
      `search_index` is notes-only and carries `content_type`. Existing items folded back via
      `scripts/migrate_items_to_notes.py` (merge/regroup/idempotent + `--heal-refs`). Dropped
      on purpose: status buckets, item ratings, TMDB/Places add-by-search. 336 backend tests.
      Plan: `~/.claude/plans/i-feel-like-the-swirling-bentley.md`.
- [x] Wishlist/Recipes/Trips fan-out removed for real (2026-07-12): despite the 2026-07-10 bullet
      above, the backend had kept fanning every product/recipe/itinerary note into
      `wish_items`/`recipe_items`/`trip_items` with zero remaining callers; that fan-out, their
      routers, and their now-dead services (`wishlist.py`/`recipes.py`/`itineraries.py`) are
      deleted. Watchlist and Places walls, and their fan-out/enrichment, are untouched.
- [x] Off Google Cloud → Vercel + OpenRouter, links-only (2026-10-03; code complete, 693 tests):
      Vertex/Gemini → OpenRouter (`_chat` helper in `services/gemini.py`, sync `OpenAI` client, `JSON_SUFFIX`
      for json mode; Gemini 2.5 Flash Lite only for YouTube URLs; Whisper `transcribe`; Qwen3 embeddings,
      `EMBED_TEXT_VERSION` 3); Cloud Tasks/OIDC → `dispatch.py` + `worker_auth.py` + sweep cron (also fixed
      the old `drain-deferred` route-shadowing bug); reel cascade + YouTube transcript-first + URL
      canonicalization (`url_utils.py`); `GOOGLE_SERVICE_ACCOUNT_JSON` credentials bootstrap in `config.py`.
      Removed: file/voice/video uploads (`uploads.py`, `VoiceRecorder`), cover persistence (`covers.py`),
      Imagen, Cloud Storage/GCS, Cloud Tasks, Firecrawl tier. Firebase Auth/Firestore/Hosting unchanged.
      **Cutover (Phase F) is pending**: create the Vercel project, create the `clip-note-vercel` SA key
      (ask first), set env vars, `vercel deploy --prod`, smoke test, embeddings re-index (search is wrong
      until done), frontend deploy (new `VITE_API_URL`), soak, then GCP teardown (each step asks first).
      Runbook: `infra/vercel.md`. Mobile app still points at Cloud Run (`mobile/README-API-URL.md`).
- [ ] Phase 3: paywall + weekly digest — **required before public launch**
- [ ] Phase 4: Typesense search + public notes · Phase 5: Expo share extension

---

## File Structure (target)

```
clip-note/
├── CLAUDE.md
├── frontend/                        # TanStack Start app
│   ├── src/
│   │   ├── routes/                  # file-based routes
│   │   │   ├── __root.tsx
│   │   │   ├── index.tsx            # home feed
│   │   │   └── notes.$noteId.tsx    # note detail
│   │   ├── integrations/
│   │   │   └── firebase/            # replaces supabase/
│   │   │       ├── client.ts
│   │   │       ├── auth.tsx
│   │   │       └── auth-middleware.ts
│   │   ├── components/
│   │   │   └── note/templates/
│   │   │       ├── RecipeNote.tsx
│   │   │       ├── ItineraryNote.tsx
│   │   │       ├── ProductNote.tsx
│   │   │       ├── SummaryNote.tsx
│   │   │       └── GenericNote.tsx  # new — smart fallback for AI-invented types
│   │   └── lib/
│   │       ├── firestore.ts         # getNotes, getNote, watchJob
│   │       └── api.ts               # ingest(url) → {job_id}
│   ├── vite.config.ts               # custom (replaces @lovable.dev/vite-tanstack-config)
│   └── package.json
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── routers/
│   │   ├── ingest.py                # POST /api/ingest — fast path
│   │   ├── process.py               # POST /api/process/{job_id} worker + GET /api/process/sweep (cron)
│   │   ├── notes.py                 # GET/DELETE /api/notes
│   │   └── jobs.py                  # GET /api/jobs — request history
│   ├── services/
│   │   ├── firebase.py              # firebase-admin: auth + Firestore
│   │   ├── gemini.py                # OpenRouter: _chat, extract, classify, ask, transcribe (name is historical)
│   │   ├── dispatch.py              # enqueue_process_job — self-POST worker dispatch
│   │   ├── worker_auth.py           # verify_worker_secret (X-Worker-Secret / cron bearer)
│   │   ├── url_utils.py             # canonical_url — strips tracking params
│   │   ├── sources/                 # youtube, social_video (reel cascade), product, reddit, generic…
│   │   ├── scraper.py               # from Distill (unchanged)
│   │   └── downloader.py            # from Distill (unchanged)
│   ├── models/note.py               # NoteExtraction Pydantic model
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── Dockerfile.vercel            # Vercel container image (binds $PORT)
│   └── vercel.json                  # daily cron → /api/process/sweep
├── mobile/README-API-URL.md         # mobile still targets the old Cloud Run URL
└── infra/
    ├── vercel.md                    # Vercel deploy, env vars, re-index runbook
    └── setup.sh                     # legacy gcloud bootstrap (pre-cutover)
```

---

## Firestore Collections

```
users/{uid}           display_name, email, photo_url, categories[], created_at
                      plan ("free"|"pro"), stripe_customer_id     # added in Phase 3
                      lifetime_tokens_{in,out}_{main,lite,embed}, lifetime_ai_calls,
                      lifetime_cost_usd                           # admin dashboard (OpenRouter usage.cost)
notes/{note_id}       user_id, content_type, title, ai_summary,
                      source_url, source_domain, source ("web"|"shortcut"|"pwa"|"ai"),
                      cover_image_url, data (flexible map), created_at, updated_at
                      template, acquisition, embedding (Vector 768)
                      is_public (default false)                   # added in Phase 4
                      source_note_ids[]  # Ask-AI notes (source="ai", template="composed")
jobs/{job_id}         user_id, url, content, source, status, note_id, error,
                      attempt_count, created_at, updated_at
usage/{uid}-{date}    user_id, date, ingest_count, ask_count   # per-user daily rate limit
system/usage-{date}   date, note_count, ask_count,             # global daily kill-switch
                      tok_tokens_{in,out}_{main,lite,embed}, tok_ai_calls,
                      tok_cost_usd                     # global daily token + $ spend
shortcut_tokens/{id}  user_id, token_hash (bcrypt), label, created_at, last_used_at  # Phase 2 (PAT)
tmdb_cache/{key}      cached TMDB details/providers (24h TTL); backend-only
places_cache/{key}    cached Google Places lookups; backend-only
search_index/{note-id}  user_id, kind ("note"), ref_id, content_type, title, summary,
                      cover_image_url, collection_id?, embedding  # backend-write-only
```

**Notes-first (2026-07-10 — the mini-app collapse):** the five mini-apps (Watchlist, Wishlist,
Recipes, Places, Trips) were removed; **every capture creates a note again** and their enrichment
now lands **inside `note.data`** via `services/enrich.py` (`enrich_note_data`, dispatched on the
same `is_entertainment`/`is_shopping`/`is_places`/`is_recipe`/`is_itinerary` matchers in
`gemini.py`, which now gate enrichment instead of item fan-out):
- entertainment → each `data.titles[]` entry gains TMDB fields (`tmdb_id`, `poster_url`,
  `overview`, `genres`, `providers[]` + `providers_region`); the first poster is adopted as the
  note cover only when coverless. Rendered by `WatchNote.tsx` (poster cards + "where to watch";
  **JustWatch attribution is mandatory wherever providers render**).
- place → each `data.venues[]` entry gains Google Places fields (`photo_url`, `lat/lng`, live
  `rating`, `opening_hours`, `action_links[]` — the region-aware Directions/Reserve/Order row);
  first photo adopted as cover. `PlaceNote.tsx` renders a venues map (`VenuesMap`) + enriched blocks.
- itinerary → `data.days[].stops[]` geocoded (`lat/lng`, capped at `TRIP_MAX_GEOCODED_STOPS`);
  `ItineraryNote.tsx` renders the stops map (`TripMap`) + a localStorage `PackingList`.
- product → `data.price` parsed into `price_amount` + `currency`.
- recipe → no external enrichment (already complete).
Enrichment fields are snake_case (looked-up) vs Gemini's camelCase (source-said); every path is
best-effort — a miss leaves a valid plain note. Cover ladder (hot-linked, never persisted): source image → enrichment
poster/photo → frontend gradient hero. `users/{uid}.region` still feeds providers + action links
(Settings → Region). Status buckets (`to_watch`/`purchased`/…), item ratings, and the TMDB/Places
"add by search" flows were deliberately dropped; favorites survive as `note.is_favorite`.
Existing item docs were folded back into notes by `scripts/migrate_items_to_notes.py`
(merge-onto-live-note, listicle regrouping, idempotent; `--heal-refs` remaps composed notes'
prefixed item ids). Frontend: home (`/`) IS the feed (`Feed home` variant — greeting + capture
chips + user Collections above the stream); `search_index` is notes-only and hits carry
`content_type`; Ask AI grounding, citations, and `goToNote` are notes-only.

`users/{uid}.categories` is the source of truth for a user's note types (kept current with
`ArrayUnion` on each new slug) — read it instead of scanning `notes`. `notes` docs store **structured
`data` only, never rendered HTML.**

**Note types** — known templates with exact data schemas:
- `recipe` → `{totalTime, servings, difficulty, ingredients: [{group?, items}], steps}`
- `itinerary` → `{destination, duration, budget, days: [{day, title, stops: [{time, place, note, lat?, lng?}]}]}`
- `product` → `{price, brand, rating, buyUrl, specs: [{label, value}], pros, cons}` (+ enriched `price_amount`, `currency`)
- `summary` → `{medium, readTime?, videoLength?, tldr, keyPoints, quotes: [{text, timestamp?}]}`
- `entertainment` → `{titles: [{title, year?, mediaType, creator?, why?, …TMDB enrichment}], listTheme?}`
  (resolved by **data shape** — `titles[]` of objects — since its slug is open; see `resolveTemplate`)
- `place` → `{venues: [{name, location?, mustTry?, …source fields, …Places enrichment}], listTheme?}`
- `*` → any AI-invented type rendered by `GenericNote`
- `template:"composed"` → Ask-AI artifact/created note: COMPOSER blocks
  (`facts/sections/steps/table/checklist`), always rendered by `GenericNote` (its
  `content_type` is a friendly slug for the pill only, never a fixed template)

---

## Commands

```bash
# Frontend dev
cd frontend && npm install && npm run dev

# Backend dev
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# (WORKER_SECRET unset locally = inline worker; no self-POST needed)

# Deploy backend (Vercel container; root = backend; env vars per infra/vercel.md)
cd backend && vercel deploy --prod

# Re-index embeddings after the Vertex -> Qwen switch (infra/vercel.md)
cd backend && python -m scripts.backfill_content_embeddings --apply --per-minute 60
# collections: clear topic_embedding first, then python -m scripts.migrate_smart_collections (or Rescan per collection)

# Manual sweep of stale jobs
curl -H "Authorization: Bearer $CRON_SECRET" https://<alias>/api/process/sweep

# Deploy frontend
cd frontend && npm run build && firebase deploy --only hosting

# Deploy Firestore rules + indexes
firebase deploy --only firestore
```

---

## Known Gotchas

- **Vercel limits a request to 300 s**: the worker is one request. `JOB_DEADLINE_S = 270` bounds retries and reel escalation; out-of-budget jobs stay `pending` for the sweep. `CLAIM_STALE_SECONDS` is 6 min for the same reason. Hobby cron is daily (±59 min, no retries).
- **Worker secret fails closed**: `WORKER_SECRET` empty → `/api/process*` rejects everything (and ingest runs the worker inline for local dev). Deployment Protection must allow the production alias or self-POST, CORS preflight and cron all 401.
- **Process worker must be idempotent**: duplicate dispatches (sweep, per-user re-dispatch) hit `_claim_job` and get 409; return early if `completed`, and mark permanent failures `failed` instead of raising 5xx.
- **DeepSeek JSON mode needs the word "json"** in the prompt — `_chat` appends `JSON_SUFFIX`; prompts that omit it (e.g. `COMPOSER_PROMPT`) would 400 otherwise.
- **`LITE_MODEL` is text-only**: `classify` never sees images; images reach `extract` via `VISION_MODEL`.
- **Embeddings must be exactly `EMBED_DIM` (768)**: send `dimensions`; if the provider ignores it the vector is truncated and renormalized; the Firestore vector indexes (`notes`, `search_index`) must match. Old Vertex vectors are incompatible — re-index after cutover.
- **Admin cost is legacy vs stored**: days ≥ `COST_CUTOVER_DATE` (default 2026-10-04, `routers/admin.py`) use stored `tok_cost_usd` / `lifetime_cost_usd`; earlier days use the old per-token formula, so pre-cutover spend drops from a user's lifetime once they have post-cutover usage (daily trend is exact).
- **yt-dlp from Vercel IPs may be blocked**: if reel T1 success is poor on the first smoke test, go Apify-first for reels (still cents/day). YouTube never depends on our IP (Gemini fetches the URL).
- **Instagram share links carry `igsh`** (and `/share/...` redirects): canonicalized away by `url_utils.canonical_url` / `sources.acquire`; dedupe and `source_url` use the canonical URL.
- **Blocking SDK calls**: the OpenAI client, yt-dlp, and `auth.verify_id_token` are synchronous — call them via `await asyncio.to_thread(...)` inside the async routes (`dispatch.enqueue_process_job` too).
- **Model IDs**: defaults live in `backend/config.py`; verify against the live OpenRouter catalog (`GET /api/v1/models`) before changing — a wrong ID fails immediately.
- **yt-dlp in Docker**: Requires `ffmpeg` in the image (`Dockerfile.vercel` keeps it); frames/audio extraction uses it.
- **TanStack Start SSR vs static**: For Firebase Hosting, build as static export. If SSR is needed later, move it to the Vercel container or Vercel itself.
- **Firestore real-time on mobile web**: `onSnapshot` works on mobile browsers but requires the Firebase JS SDK (not the admin SDK). Keep client-side Firestore calls in `src/integrations/firebase/client.ts`.
- **Vite config**: The Lovable `@lovable.dev/vite-tanstack-config` wraps Vite + TanStack Start + Tailwind + Nitro. Replacing it requires configuring all four manually — see the TanStack Start docs for the correct Vite plugin order.

---

## Reference

- Full spec: `/Users/yashsoni/.claude/plans/i-am-building-the-curried-axolotl.md`
- Distill backend (reference): `/Users/yashsoni/dev/distill/backend`
- Lovable frontend (source): `/Users/yashsoni/Downloads/Clip Note`
