#!/bin/bash
# Clip Note GCP bootstrap. Run once: bash infra/setup.sh weekly-updates-automation
set -e
PROJECT=$1
if [ -z "$PROJECT" ]; then echo "Usage: setup.sh <project-id>"; exit 1; fi

gcloud config set project "$PROJECT"

gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  storage.googleapis.com \
  aiplatform.googleapis.com \
  firebase.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  identitytoolkit.googleapis.com \
  iam.googleapis.com

# Service account for Cloud Run + Cloud Tasks OIDC
gcloud iam service-accounts create clip-note-sa \
  --display-name="Clip Note Service Account" || true

SA="clip-note-sa@${PROJECT}.iam.gserviceaccount.com"

# storage.objectUser = object CRUD without bucket-IAM administration (least privilege;
# objectAdmin would let a compromised service rewrite bucket ACLs).
for ROLE in \
  roles/aiplatform.user \
  roles/datastore.user \
  roles/cloudtasks.enqueuer \
  roles/storage.objectUser \
  roles/firebase.sdkAdminServiceAgent \
  roles/iam.serviceAccountTokenCreator; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

# The service enqueues Cloud Tasks with OIDC tokens signed as this same SA — that
# requires actAs on itself (serviceAccountUser; tokenCreator alone is NOT enough).
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser" --quiet >/dev/null

# Cloud Tasks queue (retries are bounded; the worker marks permanent failures itself.
# max-backoff keeps transient retries minutes — not the unbounded 1h default — apart)
gcloud tasks queues create clip-note-jobs \
  --location=us-central1 \
  --max-attempts=3 \
  --min-backoff=10s \
  --max-backoff=600s || true

# Media bucket (created already during Phase 0; idempotent)
gcloud storage buckets create "gs://clip-note-media-${PROJECT}" --location=us-central1 || true

# --- Data safety + observability (applied to the live project 2026-06-11) ---

# Firestore: point-in-time recovery (7-day version retention) + daily backups, 30-day retention.
gcloud firestore databases update --database='(default)' --enable-pitr || true
gcloud firestore backups schedules create --database='(default)' \
  --recurrence=daily --retention=30d || true

# Uptime check on the worker's /health endpoint.
gcloud monitoring uptime create "Clip Note API health" \
  --resource-type=uptime-url \
  --resource-labels=host="clip-note-api-674775099277.us-central1.run.app",project_id="$PROJECT" \
  --path=/health --protocol=https --period=15 --timeout=10 || true

# Alert policies (ERROR logs + queue depth) live in infra/alerts/*.json:
#   gcloud beta monitoring channels create --display-name="Clip Note alerts (email)" \
#     --type=email --channel-labels=email_address=<you>
#   gcloud alpha monitoring policies create --policy-from-file=infra/alerts/<file>.json
# Cloud Run runtime flags (applied live): --max-instances=10 (cost ceiling), 1Gi, timeout 600s.

echo ""
echo "Done. Project: $PROJECT  SA: $SA"
echo "Next: deploy Firestore rules/indexes (firebase deploy --only firestore), then Cloud Run."
