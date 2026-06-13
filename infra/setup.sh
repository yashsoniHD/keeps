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

# Covers bucket: PUBLIC-read, separate from the media bucket (which holds private video
# downloads). Note covers are re-hosted here so they're browser-displayable by https URL
# and don't expire like hot-linked source thumbnails. The runtime SA already has
# roles/storage.objectUser at the project level, so it can write here without extra grants.
gcloud storage buckets create "gs://clip-note-covers-${PROJECT}" --location=us-central1 || true
gcloud storage buckets add-iam-policy-binding "gs://clip-note-covers-${PROJECT}" \
  --member=allUsers --role=roles/storage.objectViewer || true

# Bind COVERS_BUCKET on the Cloud Run service — WITHOUT this env var the durable-cover
# code (services/covers.py) short-circuits to None and every note saves a blank cover.
# --update-env-vars merges, so other env (CLOUD_STORAGE_BUCKET, …) is preserved, and a
# subsequent `gcloud run deploy --image …` keeps env vars across image pushes.
gcloud run services update clip-note-api --region us-central1 \
  --update-env-vars "COVERS_BUCKET=clip-note-covers-${PROJECT}" || true

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

# Semantic search vector index on notes.embedding (COSINE, 768d, user_id equality prefix).
# `firebase deploy --only firestore:indexes` creates this from infra/firestore.indexes.json
# (vectorConfig). If the installed Firebase CLI predates vectorConfig support, create it
# directly with gcloud instead:
#   gcloud firestore indexes composite create \
#     --collection-group=notes --query-scope=COLLECTION \
#     --field-config=field-path=user_id,order=ascending \
#     --field-config=field-path=embedding,vector-config='{"dimension":768,"flat":"{}"}'

echo ""
echo "Done. Project: $PROJECT  SA: $SA"
echo "Next: deploy Firestore rules/indexes (firebase deploy --only firestore), then Cloud Run."
