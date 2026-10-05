#!/bin/bash
# Keeps GCP bootstrap (Firebase/Firestore + backend service account only). Run once: bash infra/setup.sh weekly-updates-automation
set -e
PROJECT=$1
if [ -z "$PROJECT" ]; then echo "Usage: setup.sh <project-id>"; exit 1; fi

gcloud config set project "$PROJECT"

gcloud services enable \
  firebase.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  iam.googleapis.com

# Runtime service account for the Vercel backend. Firestore + Firebase Auth admin only: no
# Vertex, Cloud Tasks or Storage roles. Export a key and paste it into Vercel as
# GOOGLE_SERVICE_ACCOUNT_JSON (see infra/vercel.md).
# NOTE: "clip-note-vercel" is a legacy SA name (the app is now Keeps); SA names cannot be renamed.
gcloud iam service-accounts create clip-note-vercel \
  --display-name="Keeps (Vercel backend)" || true

SA="clip-note-vercel@${PROJECT}.iam.gserviceaccount.com"

for ROLE in \
  roles/datastore.user \
  roles/firebase.sdkAdminServiceAgent; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null
done

# --- Data safety + observability (applied to the live project 2026-06-11) ---

# Firestore: point-in-time recovery (7-day version retention) + daily backups, 30-day retention.
gcloud firestore databases update --database='(default)' --enable-pitr || true
gcloud firestore backups schedules create --database='(default)' \
  --recurrence=daily --retention=30d || true

# Uptime/alerting: Cloud Run + Cloud Tasks monitoring was removed with the move to Vercel.

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
echo "Next: deploy Firestore rules/indexes (firebase deploy --only firestore), then deploy the backend (infra/vercel.md)."
