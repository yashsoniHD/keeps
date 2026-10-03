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
| `TEXT_MODEL`, `LITE_MODEL`, `VISION_MODEL`, `YOUTUBE_MODEL`, `TRANSCRIBE_MODEL`, `EMBED_MODEL` | model ids, see the migration plan table |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | key JSON for SA `clip-note-vercel` (`roles/datastore.user`). Written to `/tmp/sa.json` at boot and exported as `GOOGLE_APPLICATION_CREDENTIALS`; used by Firebase Admin, Firestore and Google Places |
| `GOOGLE_CLOUD_PROJECT` | `weekly-updates-automation` |
| `WORKER_URL` | stable production alias, e.g. `https://<project>.vercel.app` (no trailing slash) |
| `WORKER_SECRET` | random string; authenticates the self-dispatch to `/api/process*`. Empty disables the route (fail closed) and enables the local inline dev path |
| `CRON_SECRET` | random string; Vercel sends it as `Authorization: Bearer` to the cron route |
| `PUBLIC_APP_URL`, `APP_BASE_URL` | frontend origin(s) |
| `ADMIN_EMAILS` | admin dashboard allow-list |
| `TMDB_BEARER`, `APIFY_TOKEN`, `JINA_API_KEY` | enrichment / scraping |

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

## Re-index after cutover

Vertex (old) and Qwen (new) embeddings live in different vector spaces. Until both steps below
have run, search, Ask retrieval and collection auto-filing compare Vertex vectors to Qwen vectors
and return meaningless results.

1. Notes + `search_index`: from `backend/`, `python -m scripts.backfill_content_embeddings --apply --per-minute 60`
   (dry-run without `--apply`; `--user-id` to do one user first).
2. Collections (`topic_embedding`): `python -m scripts.migrate_smart_collections` does compute
   `topic_embedding`, **but skips any collection that already has one**, so on its own it will not
   re-embed existing collections. Either clear `topic_embedding` on every collection first (one-off
   Firestore update) and then run it, or hit "Rescan" per collection (`rescore_collection`
   always re-embeds).
