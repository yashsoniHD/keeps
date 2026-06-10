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

for ROLE in \
  roles/aiplatform.user \
  roles/datastore.user \
  roles/cloudtasks.enqueuer \
  roles/storage.objectAdmin \
  roles/firebase.sdkAdminServiceAgent \
  roles/iam.serviceAccountTokenCreator; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

# The service enqueues Cloud Tasks with OIDC tokens signed as this same SA — that
# requires actAs on itself (serviceAccountUser; tokenCreator alone is NOT enough).
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser" --quiet >/dev/null

# Cloud Tasks queue (retries are bounded; the worker marks permanent failures itself)
gcloud tasks queues create clip-note-jobs \
  --location=us-central1 \
  --max-attempts=3 \
  --min-backoff=10s || true

# Media bucket (created already during Phase 0; idempotent)
gcloud storage buckets create "gs://clip-note-media-${PROJECT}" --location=us-central1 || true

echo ""
echo "Done. Project: $PROJECT  SA: $SA"
echo "Next: deploy Firestore rules/indexes (firebase deploy --only firestore), then Cloud Run."
