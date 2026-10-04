# Backend on Vercel (container)

The FastAPI backend runs as a container on Vercel (Hobby, scale-to-zero). Firebase Auth,
Firestore and Hosting stay on Firebase.

## Deploy

```bash
cd backend
vercel link          # team yashsoni102-progs-projects, project root = backend
# vercel env add <NAME> production   (for each variable below)
vercel deploy --prod
```

`backend/Dockerfile.vercel` is the image (ffmpeg + yt-dlp deps; binds `$PORT`). `backend/vercel.json`
declares the daily cron. `backend/.dockerignore` keeps `.env`, `.venv`, `tests/` out of the image.

Deployment Protection must allow the production alias, or the self-dispatch POST, CORS
preflights and the cron GET all return 401.

## Environment variables (production)

| Name | Notes |
|---|---|
| `OPENROUTER_API_KEY` | all model calls |
| `VIDEO_MODELS`, `YOUTUBE_MODELS`, `IMAGE_MODELS`, `TEXT_MODELS`, `CLASSIFY_MODELS`, `EMBED_MODEL` | model chains (comma-separated `free,paid`; paid takes over on error), defaults in `backend/config.py`. `VIDEO_MODELS` defaults to `google/gemini-2.5-flash-lite` only; `IMAGE_MODELS` defaults to `google/gemini-2.5-flash-lite` only (gemma free 429'd every call; ling paid rejects >4 images, so 6-slide carousels failed); `TEXT_MODELS` defaults to `deepseek/deepseek-v3.2` only and `CLASSIFY_MODELS` to `qwen/qwen3-30b-a3b-instruct-2507` only (free heads demoted after the A/B and spike) |
| `VIDEO_CALL_TIMEOUT_S`, `VIDEO_MAX_BYTES` | video-call timeout (default 120) and max mp4 size (default 25 MB; larger files under `MAX_VIDEO_SECONDS` are ffmpeg re-encoded, needs libx264) |
| `MAX_VIDEO_SECONDS` | default 600; longer reels are not sent to the video model |
| `YOUTUBE_MAX_DIRECT_SECONDS` | default 900; longer YouTube videos use the fallback scraper (~8 s latency per minute of video) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | key JSON for SA `clip-note-vercel` (`roles/datastore.user`). Written to `/tmp/sa.json` at boot and exported as `GOOGLE_APPLICATION_CREDENTIALS`; used by Firebase Admin and Firestore |
| `GOOGLE_CLOUD_PROJECT` | `weekly-updates-automation` |
| `WORKER_URL` | stable production alias, e.g. `https://<project>.vercel.app` (no trailing slash) |
| `WORKER_SECRET` | random string; authenticates the self-dispatch to `/api/process*`. Empty disables the route (fail closed) and enables the local inline dev path |
| `CRON_SECRET` | random string; Vercel sends it as `Authorization: Bearer` to the cron route |
| `TMDB_BEARER`, `APIFY_TOKEN`, `JINA_API_KEY` | enrichment / scraping. Without `APIFY_TOKEN`, Instagram reels are never watched; every IG note is caption-only |

Generate secrets with `openssl rand -hex 32`.

## How jobs run

1. `POST /api/ingest` writes `jobs/{id}` then POSTs this deployment's `/api/process/{id}` with
   `X-Worker-Secret` and a 1.5 s read timeout. The worker only answers when done, so the timeout
   means "accepted"; a connect error or 401/403 fails the job loudly.
2. `/api/process/{id}` claims the job transactionally (duplicates get 409), runs the pipeline and
   retries transient failures in-process (5 s, 10 s) within a 270 s budget (Vercel kills requests at 300 s).
3. A job that outlives its budget, or whose worker died, stays `pending`/`processing`. Recovery:
   the daily cron `GET /api/process/sweep` (also unparks deferred captures), and every `/api/ingest`
   re-dispatches the caller's own stale jobs. Jobs older than 24 h or with 5 attempts are marked failed.

Manual sweep: `curl -H "Authorization: Bearer $CRON_SECRET" https://<alias>/api/process/sweep`

Hobby cron runs once a day (+/- 59 min, no retries). Upgrade path if recovery latency matters: Vercel Queues
with a small Node consumer service.

## Re-index embeddings

Embeddings from different models live in different vector spaces; after changing `EMBED_MODEL` /
`EMBED_TEXT_VERSION`, search compares mismatched vectors until notes are re-embedded. From `backend/`:

```bash
python -m scripts.reindex_embeddings                 # dry-run
python -m scripts.reindex_embeddings --apply         # --user-id UID to do one user first, --per-minute N
```
