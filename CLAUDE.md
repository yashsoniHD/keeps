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
Imagen-generated covers at scale.

> **Phase 0 is a real gate, not a formality.** Before building, run the extraction on 20–30 real URLs
> (recipes, products, articles, a paywalled article, a captioned video) and judge the output by hand.
> If it isn't clearly better than the source, fix the prompt before writing production code.

---

## Project IDs & Links

| Item | Value |
|------|-------|
| GCP Project ID | `weekly-updates-automation` (shared project — user's choice; Firestore + Firebase Auth were pre-enabled) |
| GCP Region | `us-central1` (infra) · **Gemini uses the `global` endpoint** (3.x models 404 on regional) |
| Firebase Project | `weekly-updates-automation` |
| Cloud Run service | `clip-note-api` |
| Cloud Tasks queue | `clip-note-jobs` |
| Cloud Storage bucket | `clip-note-media-weekly-updates-automation` |
| Firebase Hosting URL | https://weekly-updates-automation.web.app |
| Cloud Run URL | https://clip-note-api-674775099277.us-central1.run.app |
| GCP Service Account | `clip-note-sa@weekly-updates-automation.iam.gserviceaccount.com` |
| Firebase web app | "Clip Note" `1:674775099277:web:5a3293c1c0b570e392bfc4` |
| Models | `gemini-3.5-flash` (extraction) · `gemini-3.1-flash-lite` (categorization) |
| TMDB (note enrichment) | `TMDB_BEARER` env/secret on Cloud Run = TMDB v4 Read Access Token. Empty = enrichment no-op. Free API; "Streaming data by JustWatch" credit is mandatory wherever providers render. |
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
| Backend | FastAPI on Cloud Run | Adapted from Distill; Dockerized, auto-scaling |
| Job queue | Cloud Tasks | Reliable async with auto-retry; backend returns job_id in ~50ms |
| AI | Vertex AI — Gemini 2.5 Flash + Flash Lite | Dynamic note classification + extraction; billed to GCP credits |
| Image generation | Vertex AI — Imagen 3 | Cover image fallback when no og:image found |
| Storage | Cloud Storage | Temp media downloads + Imagen-generated covers |
| Hosting | Firebase Hosting | Frontend static export |

---

## Architecture

```
User pastes URL
  → POST /api/ingest (Firebase ID token)
  → Write Firestore: jobs/{job_id} {status: "pending"}
  → Enqueue Cloud Task → /api/process/{job_id}
  → Return {job_id} in ~50ms

[Cloud Tasks calls /api/process/{job_id}]  (OIDC-authenticated; idempotent — no-op if already completed)
  → Update job {status: "processing"}
  → Detect: video URL → yt-dlp (transcript-first)  OR  webpage → BeautifulSoup
  → Cover image: og:image → yt-dlp thumbnail → first <img> → Imagen (if ENABLE_IMAGEN, capped) → frontend gradient hero
  → Gemini → {content_type, title, ai_summary, cover_image_prompt, data{}}   (structured data only — no HTML)
  → Write Firestore: notes/{note_id}
  → Update job {status: "completed", note_id}

[Frontend Firestore onSnapshot on jobs/{job_id}]
  → Note appears automatically, navigate to /notes/{note_id}
```

### Key Architecture Decisions

- **No Supabase** — replaced with Firebase Auth + Firestore (all Google, uses GCP credits)
- **Cloud Tasks not Pub/Sub** — simpler ops, built-in retry, sufficient for this scale
- **Single Cloud Run service** — handles both fast ingest path and Cloud Tasks worker endpoint; **OIDC token (not a shared secret)** on `/api/process` keeps it private even though the service allows unauthenticated front-end calls
- **Structured data, not stored HTML** — Gemini returns a structured `data` map; React templates render it (`RecipeNote`, `ItineraryNote`, `ProductNote`, `SummaryNote`, and a `GenericNote` fallback for AI-invented types). This keeps the design restylable, cheaper (fewer output tokens), consistent, and free of `dangerouslySetInnerHTML`. **Do not have the model emit HTML.**
- **Dynamic note types** — Gemini invents `content_type` slugs, matched/normalized against the user's existing `categories` array (`users/{uid}.categories`) — no full-collection scan per ingest; `GenericNote` renders any type without a dedicated template
- **Imagen cover fallback — IMPLEMENTED, gated off by default (`ENABLE_IMAGEN=false`).** Covers come from og:image → video thumbnail → first `<img>`; only a note that would otherwise be coverless triggers Imagen (`backend/services/imagen.py`, `generate_cover` — regional Vertex client, called from `process.py` *before* the note doc is written, so the detail view's one-time read sees it). Generation is best-effort: any miss (flag off, daily cap, RAI-filter, error) leaves the cover null and the **frontend renders a gradient + type-icon hero** (`NoteContent.tsx` `CoverHero`) — the detail view is never empty. Imagen is the exception, not the default — a real cost line — so it is capped: `MAX_IMAGES_PER_USER_PER_DAY` + `DAILY_GLOBAL_IMAGE_CAP` via a transactional `reserve_image_slot` (returns False instead of raising — a capped note still gets created), metered to `users/{uid}.lifetime_images` + `system/usage-{date}.image_count`, and priced in the admin dashboard at `IMAGEN_PRICE_PER_IMAGE`. Before turning it on: verify `IMAGEN_MODEL` (`imagen-3.0-generate-002` may be superseded) + region against the live Vertex catalog, request a quota increase, then set `ENABLE_IMAGEN=true` on Cloud Run.
- **Cost guardrails are mandatory** — budget is ~₹30k (~$360 ≈ a few thousand notes *total*). Per-user daily ingest cap + per-user note cap + a global daily kill-switch counter, enforced in `/api/ingest`. Set a GCP billing budget alert. Transcript-first video handling (below) keeps the most expensive path cheap.

---

## Current State

**Status: Phase 0 passed + Phase 1 deployed (2026-06-10)**

The app is live: https://weekly-updates-automation.web.app → Cloud Run API → Cloud Tasks worker →
Firestore. Phase 0 validated 20/20 real URLs (report: `phase0/REPORT.md`); the user explicitly
passed the gate.

### Architecture notes that supersede older sections of this file
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
│   │   ├── process.py               # POST /api/process/{job_id} — Cloud Tasks worker
│   │   ├── notes.py                 # GET/DELETE /api/notes
│   │   └── jobs.py                  # GET /api/jobs — request history
│   ├── services/
│   │   ├── firebase.py              # firebase-admin: auth + Firestore
│   │   ├── gemini.py                # Vertex AI: analyze_text, analyze_media
│   │   ├── imagen.py                # Vertex AI: generate_cover_image → GCS URL
│   │   ├── cloud_tasks.py           # enqueue_process_job
│   │   ├── scraper.py               # from Distill (unchanged)
│   │   └── downloader.py            # from Distill (unchanged)
│   ├── models/note.py               # NoteExtraction Pydantic model
│   ├── requirements.txt
│   └── Dockerfile
└── infra/
    └── setup.sh                     # gcloud bootstrap commands
```

---

## Firestore Collections

```
users/{uid}           display_name, email, photo_url, categories[], created_at
                      plan ("free"|"pro"), stripe_customer_id     # added in Phase 3
                      lifetime_tokens_{in,out}_{main,lite}, lifetime_ai_calls  # admin dashboard
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
                      tok_tokens_{in,out}_{main,lite}, tok_ai_calls  # global daily token spend
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
best-effort — a miss leaves a valid plain note. Cover ladder: source image → enrichment
poster/photo → Imagen (gated). `users/{uid}.region` still feeds providers + action links
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

# Bootstrap GCP (run once)
bash infra/setup.sh

# Deploy backend
gcloud builds submit --tag gcr.io/$GCP_PROJECT/clip-note-api ./backend
gcloud run deploy clip-note-api --image gcr.io/$GCP_PROJECT/clip-note-api

# Deploy frontend
cd frontend && npm run build && firebase deploy --only hosting

# Deploy Firestore rules + indexes
firebase deploy --only firestore
```

---

## Known Gotchas

- **Cloud Tasks → Cloud Run auth**: The `/api/process/{job_id}` endpoint must verify the Cloud Tasks **OIDC token** (enqueue with `oidc_token`; verify with `google.oauth2.id_token.verify_oauth2_token` against the SA email + worker-URL audience), **not** a static shared secret and not a Firebase user token.
- **Process worker must be idempotent**: Cloud Tasks retries on any 5xx. Return early if `job.status == "completed"` so retries never re-run paid AI work, and avoid 5xx for permanent failures (mark `failed`, return 200).
- **Video is transcript-first**: prefer yt-dlp subtitles/auto-captions → feed the transcript to `analyze_text` (cheap, no size limit). Only short videos with no transcript get uploaded to GCS and passed to Gemini by `gs://` URI — **never inline bytes** (`Part.from_bytes` caps ~20 MB and fails most videos). Enforce a `MAX_VIDEO_SECONDS` duration cap.
- **Blocking SDK calls**: Gemini, yt-dlp, Imagen, and `auth.verify_id_token` are synchronous — call them via `await asyncio.to_thread(...)` inside the async routes so they don't stall the event loop.
- **Model IDs**: defaults are `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `imagen-3.0-generate-002` — **confirm against the live Vertex AI catalog** before first run; a wrong ID fails immediately.
- **Imagen 3 quota**: Default quota is low; request increase via GCP console before launch.
- **yt-dlp in Docker**: Requires `ffmpeg` installed in the container (already in Distill's Dockerfile — keep it).
- **TanStack Start SSR vs static**: For Firebase Hosting, build as static export. If SSR is needed later, move to Cloud Run.
- **Firestore real-time on mobile web**: `onSnapshot` works on mobile browsers but requires the Firebase JS SDK (not the admin SDK). Keep client-side Firestore calls in `src/integrations/firebase/client.ts`.
- **Vite config**: The Lovable `@lovable.dev/vite-tanstack-config` wraps Vite + TanStack Start + Tailwind + Nitro. Replacing it requires configuring all four manually — see the TanStack Start docs for the correct Vite plugin order.

---

## Reference

- Full spec: `/Users/yashsoni/.claude/plans/i-am-building-the-curried-axolotl.md`
- Distill backend (reference): `/Users/yashsoni/dev/distill/backend`
- Lovable frontend (source): `/Users/yashsoni/Downloads/Clip Note`
