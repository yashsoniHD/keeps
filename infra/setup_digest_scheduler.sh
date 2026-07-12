#!/bin/bash
# Weekly digest scheduler. Creates (or updates) a Cloud Scheduler job that POSTs to the
# OIDC-authed /api/digest/run worker once a week, so the batch send actually fires.
#
# Idempotent: creates the job if it's missing, otherwise updates it in place — safe to re-run.
#
# PREREQUISITE: the digest is a no-op until RESEND_API_KEY + DIGEST_FROM_EMAIL (and, ideally,
# DIGEST_UNSUB_SECRET) are set on the Cloud Run service. Set those first, or every scheduled
# run will "send" nothing:
#   gcloud run services update clip-note-api --region us-central1 \
#     --update-secrets RESEND_API_KEY=RESEND_API_KEY:latest \
#     --set-env-vars 'DIGEST_FROM_EMAIL=Clipnote <digest@clipnote.app>'
#
# Usage: bash infra/setup_digest_scheduler.sh [project-id]
set -e

PROJECT="${1:-weekly-updates-automation}"
REGION="us-central1"
JOB="clip-note-weekly-digest"
SA="clip-note-sa@${PROJECT}.iam.gserviceaccount.com"

# The worker's base URL. verify_oidc() (backend/services/oidc.py) checks the OIDC token
# audience against CLOUD_TASKS_WORKER_URL — the BASE url, not the path — exactly as Cloud
# Tasks enqueues it. So --uri carries the /api/digest/run path while --oidc-token-audience
# stays the bare base url, or the token is rejected with 403.
WORKER_BASE="https://clip-note-api-674775099277.us-central1.run.app"
URI="${WORKER_BASE}/api/digest/run"

gcloud config set project "$PROJECT"
gcloud services enable cloudscheduler.googleapis.com --quiet >/dev/null

# Weekly, Sunday 08:00 Asia/Kolkata. Cloud Scheduler retries a failed run (the batch itself is
# best-effort per user, so a retry just re-attempts anyone not yet sent this run).
SCHEDULE="0 8 * * 0"
TZ="Asia/Kolkata"

COMMON_ARGS=(
  --location="$REGION"
  --schedule="$SCHEDULE"
  --time-zone="$TZ"
  --uri="$URI"
  --http-method=POST
  --oidc-service-account-email="$SA"
  --oidc-token-audience="$WORKER_BASE"
  --attempt-deadline=320s
)

if gcloud scheduler jobs describe "$JOB" --location="$REGION" >/dev/null 2>&1; then
  echo "Updating existing scheduler job '$JOB'…"
  gcloud scheduler jobs update http "$JOB" "${COMMON_ARGS[@]}" --quiet
else
  echo "Creating scheduler job '$JOB'…"
  gcloud scheduler jobs create http "$JOB" "${COMMON_ARGS[@]}" --quiet
fi

echo "Done. Trigger a one-off test run with:"
echo "  gcloud scheduler jobs run $JOB --location=$REGION"
