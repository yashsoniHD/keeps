# Clip Note

Save any URL as a structured note. Paste or share a link; the app analyses the content (video included) and produces a note you can browse in a feed, search, and filter by category. Note types are AI-determined and open-ended.

**One job: link -> structured note -> feed / search / category filter.** Web app only (PWA share target + iOS Shortcut for phone capture). Removed (2026-10): Ask AI, collections, digests, Places/Watchlist/wishlist/recipe/trip mini-apps, public share links, annotations, favorites/pins, admin dashboard, category editor (rename/merge/icon), file/voice uploads. Old notes carrying those fields must still render (the frontend ignores unknown fields).

Open item: a paywall before public launch (the weekly digest is dropped). Retention = the feed and search.

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
| Models | See "Models" below. All env-overridable in `backend/config.py`. |
| TMDB (note enrichment) | `TMDB_BEARER` env on Vercel = TMDB v4 Read Access Token. Empty = enrichment no-op. Free API; "Streaming data by JustWatch" credit is mandatory wherever providers render. |
| Billing budget | "Clip Note credits guard" ₹30,000 (50/80/100% alerts) |

---

## Tech Stack

Frontend: Vite SPA (React 19, Tailwind 4, shadcn/ui), Firebase Hosting. Auth: Firebase Google Sign-In. DB: Firestore (schema-less; AI-invented types need no migrations). Backend: FastAPI container on Vercel Hobby (`Dockerfile.vercel`, 300 s/request). AI: OpenRouter.

---

## Architecture

```
paste / PWA share / iOS Shortcut (PAT)
  -> POST /api/ingest (Firebase JWT or PAT; URL canonicalized; per-user duplicate source_url returns the existing note)
  -> jobs/{id} pending -> self-POST /api/process/{id} (X-Worker-Secret, 1.5 s read timeout = accepted)

/api/process/{id}  (idempotent claim; budget JOB_DEADLINE_S=270; transient retry in-process)
  reel (IG/TikTok/FB)  -> get the video file (Instagram: Apify only; TikTok/FB: yt-dlp, Apify if that fails)
                          -> video+audio model (caption + top comments as context) -> note
  YouTube (<=900 s)    -> Gemini watches the URL; on VideoUnreadable -> fallback scraper (captions/Apify)
  carousel / images    -> vision model (<=6 images, 768 px)
  web / X / Reddit / product -> text model
  -> notes/{id} {content_type, title, ai_summary, data{}}; TMDB enrichment inside note.data for entertainment
  -> jobs/{id} completed {note_id}

Daily cron GET /api/process/sweep re-dispatches stale pending/processing jobs.
Frontend: onSnapshot on jobs/{id}; feed reads notes via Firestore; search/edit/delete/re-extract via the API.
```

Key decisions:
- **Structured data, not HTML.** The model returns `data`; React templates render it (Recipe, Product, Summary, Workout, Itinerary and Place as plain lists, Watch with TMDB posters, Generic fallback). Never have the model emit HTML.
- **Dispatch, not a queue.** `services/dispatch.py` self-POSTs the worker; `JOB_DEADLINE_S=270` bounds retries; out-of-budget jobs stay `pending` for the sweep; jobs >24 h or 5 attempts fail.
- **Worker auth fails closed** (`services/worker_auth.py`): empty `WORKER_SECRET` rejects `/api/process*`; locally it is unset and ingest runs the worker inline.
- **Acquisition cache** (`acq_cache`, 6 h, keyed by canonical URL): scrape metadata only (caption, comments, media URL, thumbnail); never video bytes. Retries and the sweep reuse it.
- **A save never fails just because the video was missing**: the note is built from caption + cover and marked thin.
- **Search** queries `notes` directly: keyword substring on title/summary (`.select()` projection, 3-char minimum) + Firestore `find_nearest` on `notes.embedding` (user_id filter). No separate index collection.
- **Cost guardrails are mandatory**: per-user daily ingest/search caps, per-user note cap, global daily spend counter (`system/usage-{date}`), `APIFY_DAILY_GLOBAL_CAP`, SSRF guard on every outbound fetch (`services/net_guard.py`).
- **URL canonicalization** (`services/url_utils.py`) strips tracking params; IG/FB `/share/` links resolve in `sources.acquire`.

---

## Models (OpenRouter `models: [free, paid]`; paid takes over on 429/error/timeout; defaults in `backend/config.py`)

| Job | Free first | Paid fallback |
|---|---|---|
| Reel video + audio | none (free omni demoted: 5-7x slower, capacity-limited) | `google/gemini-2.5-flash-lite` (~$0.002-0.011/clip) |
| YouTube | none | `google/gemini-2.5-flash-lite` |
| Images | none (gemma free 429'd every call; ling paid rejects >4 images) | `google/gemini-2.5-flash-lite` |
| Text notes | none (free head demoted: fabrication) | `deepseek/deepseek-v3.2` |
| Classify | rules, then none (free head demoted: 0% availability) | `qwen/qwen3-30b-a3b-instruct-2507` |
| Embeddings (768-dim) | none | `qwen/qwen3-embedding-8b` |

Free heads were trialled and demoted on 2026-10-04 per phase0/ab (fabrication, 0% availability, latency); re-trial by setting the *_MODELS env vars. Free endpoints need OpenRouter Settings -> Privacy to allow them.

---

## Firestore Collections

```
users/{uid}          display_name, email, photo_url, region, categories[], created_at
notes/{note_id}      user_id, content_type, title, ai_summary, source_url, source_domain,
                     source ("web"|"shortcut"|"pwa"), cover_image_url (hot-linked),
                     data (flexible map), template, acquisition, embedding (Vector 768),
                     embedding_version, created_at, updated_at
jobs/{job_id}        user_id, url, status, note_id, error, attempt_count, created_at, updated_at
shortcut_tokens/{id} user_id, token_hash (bcrypt), label, created_at, last_used_at   (backend-only)
usage/{uid}-{date}   ingest_count, search_count          (backend-only rate limits)
system/usage-{date}  global daily note count + spend      (backend-only kill switch)
tmdb_cache/{key}     TMDB details/providers, 24 h         (backend-only)
acq_cache/{key}      scrape metadata by canonical URL, 6 h (backend-only)
```

`users/{uid}.categories` is the source of truth for a user's note types (ArrayUnion on each new slug). Notes store structured `data` only. Legacy collections for removed features (conversations, place_items, watch_items, recipe/trip/wish items, collections, annotations, search_index, places_cache) are left in Firestore until the owner deletes them; rules deny all client access.

Note templates: `recipe`, `itinerary` (plain list), `product`, `summary`, `workout`, `entertainment` (`titles[]` + TMDB fields; resolved by data shape), `place` (plain `venues[]` list), `*` -> GenericNote. Legacy `template:"composed"` notes render via GenericNote.

---

## File Structure

```
backend/
  main.py, config.py
  routers/   ingest, process (worker + sweep), notes (PATCH/DELETE/reextract), search,
             categories (list, delete-with-retag), tokens, client_errors, health
  services/  firebase, gemini (OpenRouter _chat, extract, extract_from_video, classify),
             embeddings, usage_meter, dispatch, worker_auth, url_utils, net_guard, enrich (TMDB),
             apify, sources/ (youtube, social_video, product, reddit, twitter, generic ...)
  models/note.py
  scripts/   verify_apify.py, reindex_embeddings.py, ab_baseline.py
  Dockerfile.vercel, vercel.json (daily sweep cron), requirements.txt, tests/
frontend/    Vite SPA: routes (feed/home, note detail, search, settings, share target),
             components/note/templates/*, lib/api.ts, lib/firestore.ts
infra/       firestore.rules, firestore.indexes.json, vercel.md, setup.sh, build_shortcut.py
```

---

## Commands

```bash
cd frontend && npm install && npm run dev            # frontend
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8080   # backend (WORKER_SECRET unset = inline worker)
cd backend && .venv/bin/python -m pytest -q          # tests
vercel deploy --prod --yes                           # backend, from the REPO ROOT (root dir setting = backend; env vars: infra/vercel.md)
cd frontend && npm run build && firebase deploy --only hosting
firebase deploy --only firestore                     # rules + indexes
cd backend && python -m scripts.reindex_embeddings --apply   # after changing EMBED_MODEL/EMBED_TEXT_VERSION
curl -H "Authorization: Bearer $CRON_SECRET" https://<alias>/api/process/sweep   # manual sweep
```

---

## Known Gotchas

- **Vercel limits a request to 300 s.** The worker is one request; `JOB_DEADLINE_S=270`; `CLAIM_STALE_SECONDS` 6 min. Hobby cron is daily.
- **Deployment Protection must allow the production alias**, or self-POST, CORS preflight and cron all 401.
- **Worker must be idempotent**: duplicate dispatches hit `_claim_job` (409); completed = no-op; permanent failures are marked `failed`, not 5xx.
- **Video request size**: a 25 MB mp4 is ~33 MB base64. `VIDEO_MAX_BYTES` stays 25 MB (Gemini accepted an 80 MB body in the spike); a hard ~120 s `VIDEO_CALL_TIMEOUT_S` lets a fallback fire on timeout if a chain has more than one model.
- **Without `APIFY_TOKEN`, Instagram reels are never watched; every IG note is caption-only (thin).**
- **Video duration gate + re-encode**: reels over `MAX_VIDEO_SECONDS` (600) are not sent; YouTube is sent directly only up to `YOUTUBE_MAX_DIRECT_SECONDS` (900; ~8 s latency per minute of video, an 11-min video took 88 s and a 31-min one timed out the 120 s call cap). Files over 25 MB but under 10 min are re-encoded with ffmpeg to fit, so the ffmpeg in `Dockerfile.vercel` must include libx264.
- **Instagram CDN video URLs expire in hours**; the acquisition cache keeps the URL, not the bytes. Expired -> run the ladder again.
- **DeepSeek JSON mode needs the word "json"** in the prompt (`_chat` appends `JSON_SUFFIX`). Models without `response_format` (e.g. a re-trialled free omni) rely on the prompt enforcing JSON and the parser repairing it.
- **Embeddings must be exactly 768 dims**; the `notes` vector index (user_id + embedding) must match. Re-index after changing the embed model.
- **TMDB**: "Streaming data by JustWatch" attribution is mandatory wherever providers render. `TMDB_BEARER` empty = enrichment no-op.
- **Blocking SDK calls** (OpenAI client, yt-dlp, `verify_id_token`) go through `asyncio.to_thread`.
- **Model IDs**: verify against `GET https://openrouter.ai/api/v1/models` before changing; a wrong ID fails immediately.
- **yt-dlp/ffmpeg**: `Dockerfile.vercel` keeps ffmpeg. yt-dlp from Vercel IPs may be blocked; Apify is the paid fallback.
- **Firestore real-time on web** needs the JS SDK (client) in `src/integrations/firebase/client.ts`.

---

## Reference

- Plan: `/Users/yashsoni/.claude/plans/make-the-app-more-humming-hippo.md`
- Deploy runbook: `infra/vercel.md`
