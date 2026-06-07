# Clip Note

Save any URL as a beautifully structured note. Paste a link — the app scrapes or downloads the content, sends it through Gemini, and produces a richly structured note with a cover image. Note types are AI-determined and open-ended; new categories emerge automatically.

---

## Product Focus

**Primary use case (MVP wedge):** turn saved links into notes worth *re-reading* — the value is not
in capturing, it's in the structured note being better than the source and easy to come back to.

**Target user:** someone who already saves links constantly (recipes, articles, products, travel)
and loses them in a graveyard of tabs/bookmarks they never reopen.

**Retention hook (MVP scope):** good in-feed search + a genuinely real-time feed. The capture flow is
the easy part; *coming back* is the product. Anything that does not serve re-discovery is post-MVP.

**Post-MVP retention/growth backlog:** resurfacing/reminders, user-owned collections, public
server-rendered share pages (SEO + viral loop), iOS share-sheet shortcut.

> Open risk to validate cheaply before scaling: that AI re-structuring is genuinely more useful than
> the source (run the extraction on ~20 real URLs and judge the output by hand first).

---

## Project IDs & Links

| Item | Value |
|------|-------|
| GCP Project ID | _TODO: set after `gcloud projects create`_ |
| GCP Region | `us-central1` |
| Firebase Project | _same as GCP project_ |
| Cloud Run service | `clip-note-api` |
| Cloud Tasks queue | `clip-note-jobs` |
| Cloud Storage bucket | `clip-note-media` |
| Firebase Hosting URL | _TODO: after `firebase deploy`_ |
| Cloud Run URL | _TODO: after first deploy_ |
| GCP Service Account | `clip-note-sa@<PROJECT>.iam.gserviceaccount.com` |
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
  → Cover image: og:image → yt-dlp thumbnail → first <img> → Imagen 3 (visual content types only)
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
- **Imagen 3 fallback (visual types only)** — covers come from og:image → video thumbnail → first `<img>`; Imagen is called **only** when none found *and* the content type is visual (recipe, product, travel…). Non-visual notes get a generated gradient placeholder. Imagen is the exception, not the default — it is a real cost line.
- **Cost guardrails are mandatory** — budget is ~₹30k (~$360 ≈ a few thousand notes *total*). Per-user daily ingest cap + per-user note cap + a global daily kill-switch counter, enforced in `/api/ingest`. Set a GCP billing budget alert. Transcript-first video handling (below) keeps the most expensive path cheap.

---

## Current State

**Status: Planning complete — ready to build**

Nothing has been built yet. The plan is fully designed and approved. Next session starts at Phase 1 (project setup).

### What exists
- `/Users/yashsoni/Downloads/Clip Note` — Lovable frontend (TanStack Start, beautiful design, mock data only, Supabase references to remove)
- `/Users/yashsoni/dev/distill/backend` — FastAPI reference backend (Gemini + yt-dlp + scraper; uses Supabase — to be adapted)
- `/Users/yashsoni/.claude/plans/i-am-building-the-curried-axolotl.md` — full spec

### What needs to be built (in order)
- [ ] GCP project bootstrap (`infra/setup.sh`)
- [ ] Backend: build from scratch (Distill is reference only — it had reliability issues), on Firebase + Cloud Tasks + Imagen
- [ ] Frontend: copy from Lovable, remove Lovable branding, add Firebase auth + Firestore
- [ ] Wire capture flow end-to-end
- [ ] Deploy backend to Cloud Run
- [ ] Deploy frontend to Firebase Hosting
- [ ] End-to-end verification (8 test cases in spec)

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
notes/{note_id}       user_id, content_type, title, ai_summary,
                      source_url, source_domain, cover_image_url,
                      data (flexible map), created_at, updated_at
jobs/{job_id}         user_id, url, status, note_id, error,
                      attempt_count, created_at, updated_at
usage/{uid}-{date}    user_id, date, ingest_count        # per-user daily rate limit
system/usage-{date}   date, note_count                   # global daily kill-switch
```

`users/{uid}.categories` is the source of truth for a user's note types (kept current with
`ArrayUnion` on each new slug) — read it instead of scanning `notes`. `notes` docs store **structured
`data` only, never rendered HTML.**

**Note types** — known templates with exact data schemas:
- `recipe` → `{totalTime, servings, difficulty, ingredients: [{group?, items}], steps}`
- `itinerary` → `{destination, duration, budget, days: [{day, title, stops: [{time, place, note}]}]}`
- `product` → `{price, brand, rating, buyUrl, specs: [{label, value}], pros, cons}`
- `summary` → `{medium, readTime?, videoLength?, tldr, keyPoints, quotes: [{text, timestamp?}]}`
- `*` → any AI-invented type rendered by `GenericNote`

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
