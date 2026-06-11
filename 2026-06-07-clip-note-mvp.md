# Clip Note — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional Clip Note web app — paste any URL, get a beautifully structured AI note with a cover image, stored in Firestore, rendered via Gemini-generated HTML.

**Architecture:** TanStack Start frontend (cleaned from Lovable) → Firebase Auth (Google Sign-In) → FastAPI on Cloud Run → Cloud Tasks async processing (OIDC-authenticated, idempotent) → Firestore storage. Gemini returns **structured `data` only**; React templates render it. Categories are per-user and AI-managed via a `users/{uid}.categories` array.

**Tech Stack:** React 19 / TanStack Router / Tailwind 4 / Firebase / Firestore / FastAPI / Cloud Run / Cloud Tasks / Vertex AI (gemini-2.5-flash + gemini-2.5-flash-lite + Imagen 3) / Cloud Storage

---

## Context

Clip Note is a web app (later iOS + Android) that lets users save any URL as a beautifully structured note. The user pastes a link; the app scrapes or downloads the content, sends it through Gemini, and saves a richly-structured note with a cover image. Note types are AI-determined and **per-user** — Gemini looks at what categories the user already has and either places the note there or invents a new one.

The frontend design already exists (Lovable-built TanStack Start app at `/Users/yashsoni/Downloads/Clip Note`). The backend is **built from scratch** (the Distill backend at `/Users/yashsoni/dev/distill/backend` is reference only — do not copy it; it had reliability issues). The full stack runs on Google Cloud (**INR 30,000 credits ≈ $360 USD — be cost-conscious**). No Supabase — all Google.

**Rendering decision (binding):** Gemini outputs a structured `data` map — **never rendered HTML**. The frontend renders with typed React templates (`RecipeNote`, `ItineraryNote`, `ProductNote`, `SummaryNote`) plus a `GenericNote` fallback for AI-invented types. This keeps the design restylable, cheaper (fewer output tokens), consistent, and free of `dangerouslySetInnerHTML`.

**Cost model (binding):** budget is ~$360 ≈ only a few thousand notes *total*, so cost control is a feature, not a nicety:
- Per-note cost ≈ scrape + one lite classify (~50 tokens) + one main extraction (compact JSON, not HTML) ≈ small. Video uses the **transcript**, not the raw bytes, keeping the worst case cheap. Imagen (~₹1.60/image) runs only for visual content types with no found cover.
- Enforced caps: per-user daily ingest limit, per-user note cap, and a global daily kill-switch counter (all in `/api/ingest`). Set a **GCP billing budget alert** before launch.

**Models (confirm IDs against the live Vertex AI catalog before first run):**
- Main: `gemini-2.5-flash` (Vertex AI, us-central1) — structured extraction (JSON `data` only)
- Lite: `gemini-2.5-flash-lite` — category assignment only (~50 tokens per call)
- Imagen 3 (`imagen-3.0-generate-002`): only when no cover found **and** the content type is visual (~₹1.60/image)

---

## Build Order & Phasing (binding)

The work is sequenced so the **core bet, monetization, retention, and growth each get de-risked in
turn** rather than everything being built and then launched at once. Tasks 1–14 below are the
Phase 1 build; the phase table tells you what wraps around them.

| Phase | What | Gate |
|-------|------|------|
| 0 | Validate AI output on 20–30 real URLs | Blocks everything |
| 1 | Core backend + frontend (Tasks 1–14, with the fixes folded in) | Working capture-to-note |
| 2 | PWA share target + iOS shortcut/PAT | Capture is a reflex |
| 3 | Paywall + weekly digest email | Before public launch |
| 4 | Typesense search + public notes | First month of usage |
| 5 | Expo native share extension | After web validation |

**Hard rules:** don't skip Phase 0; don't launch publicly before Phase 3 is done.

Phases 2–5 are specified after Task 14 (each is its own task block). Phase 0 is below — it runs before
any building.

---

## Phase 0: Validation gate (blocking, ~1 day)

**Goal:** prove the core bet — that an AI-restructured note is genuinely more useful than its source —
before writing production code.

- [ ] **Step 0.1: Run the Step 2 extraction prompt against 20–30 real URLs** spanning the real mix:
  recipes, products, articles, at least one paywalled article, and a captioned video.
- [ ] **Step 0.2: Read each output note next to its source.** If recipes/products/articles are clearly
  better than the source, proceed to Phase 1. If output is mediocre, **fix the prompt here** (iterate
  on `EXTRACTION_SYSTEM` / the per-type prompts) before building anything else.

> This is a gate, not a formality. A weak Phase 0 means the whole product premise is weak — surface
> that now, cheaply, rather than after the full stack is built.

---

## File Map

### Frontend (`frontend/`)
| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Remove `@lovable.dev/vite-tanstack-config`, `@supabase/supabase-js`; add `firebase` |
| `vite.config.ts` | Replace | Custom Vite + TanStack Router + Tailwind config (no Lovable wrapper) |
| `.lovable/` | Delete | Lovable metadata |
| `src/lib/lovable-error-reporting.ts` | Delete | Lovable telemetry |
| `src/integrations/supabase/` | Delete | Replace with Firebase |
| `src/integrations/firebase/client.ts` | Create | Firebase app + auth + Firestore init |
| `src/integrations/firebase/auth-middleware.ts` | Create | `getAuthHeader()` → Bearer token |
| `src/contexts/auth-context.tsx` | Create | Auth state, signInWithGoogle, signOut |
| `src/lib/types.ts` | Create | `Note`, `Job` TypeScript interfaces |
| `src/lib/firestore.ts` | Create | `getNotes`, `getNote`, `watchJob`, `getUserCategories` |
| `src/lib/api.ts` | Create | `ingest(url)` → POST /api/ingest |
| `src/lib/mock-notes.ts` | Delete | Replaced by Firestore |
| `src/routes/__root.tsx` | Modify | Remove Lovable imports; wrap with AuthProvider |
| `src/routes/login.tsx` | Create | Google Sign-In page |
| `src/routes/index.tsx` | Replace | Real Firestore data, dynamic filter chips |
| `src/routes/notes.$noteId.tsx` | Replace | Firestore fetch + NoteContent renderer |
| `src/routes/settings.tsx` | Replace | Fully functional settings (profile, sign out, clear notes) |
| `src/components/CaptureModal.tsx` | Modify | Real API call + Firestore job listener |
| `src/components/NoteContent.tsx` | Create | Switches on `content_type` → typed template / `GenericNote` (no HTML injection) |
| `src/components/note/templates/` | Keep + add `GenericNote.tsx` | Typed renderers for `data`; `GenericNote` renders any AI-invented type |
| `.env` | Replace | Firebase config + API URL |
| `firebase.json` | Create | Firebase Hosting config (SPA rewrites) |
| `.firebaserc` | Create | Firebase project alias |

### Backend (`backend/`)
| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, CORS, routers |
| `config.py` | Settings from env vars |
| `routers/ingest.py` | POST /api/ingest — fast path, enforces cost caps |
| `routers/process.py` | POST /api/process/{job_id} — Cloud Tasks worker (OIDC-verified, idempotent) |
| `routers/notes.py` | GET/DELETE /api/notes |
| `routers/jobs.py` | GET /api/jobs |
| `services/auth_dep.py` | Shared `require_user` FastAPI dependency (used by notes/jobs) |
| `services/firebase.py` | firebase-admin init, singleton Firestore client, verify_firebase_token, get/update user categories |
| `services/gemini.py` | Two-step pipeline: category (lite) → structured `data` extraction (main); non-blocking |
| `services/imagen.py` | Vertex AI Imagen 3 → Cloud Storage URL (no per-object ACL) |
| `services/cloud_tasks.py` | enqueue_process_job with OIDC token |
| `services/scraper.py` | async httpx + BeautifulSoup |
| `services/downloader.py` | yt-dlp wrapper — transcript-first, duration cap |
| `models/note.py` | NoteExtraction (no `rendered_html`), IngestRequest Pydantic models |
| `Dockerfile` | python:3.11-slim + ffmpeg |
| `requirements.txt` | All Python deps |

### Infrastructure (`infra/`)
| File | Purpose |
|------|---------|
| `setup.sh` | Enable GCP APIs, create service account, assign roles |
| `firestore.rules` | Firestore security rules |
| `firestore.indexes.json` | Composite indexes |

---

## Task 1: Project scaffold + GCP bootstrap

**Files:**
- Create: `infra/setup.sh`
- Create: `infra/firestore.rules`
- Create: `infra/firestore.indexes.json`
- Create: `backend/requirements.txt`
- Create: `backend/config.py`

- [ ] **Step 1.1: Init git and copy frontend**
```bash
cd /Users/yashsoni/dev/clip-note
git init
cp -r "/Users/yashsoni/Downloads/Clip Note/." frontend/
```

- [ ] **Step 1.2: Create backend directory structure**
```bash
mkdir -p backend/routers backend/services backend/models
mkdir -p infra
touch backend/__init__.py backend/routers/__init__.py backend/services/__init__.py backend/models/__init__.py
```

- [ ] **Step 1.3: Write infra/setup.sh**
```bash
#!/bin/bash
# Run once: bash infra/setup.sh <GCP_PROJECT_ID>
set -e
PROJECT=$1
if [ -z "$PROJECT" ]; then echo "Usage: setup.sh <project-id>"; exit 1; fi

gcloud config set project $PROJECT

gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  storage.googleapis.com \
  aiplatform.googleapis.com \
  firebase.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com

# Create service account
gcloud iam service-accounts create clip-note-sa \
  --display-name="Clip Note Service Account" || true

SA="clip-note-sa@${PROJECT}.iam.gserviceaccount.com"

# Assign roles
for ROLE in \
  roles/aiplatform.user \
  roles/datastore.user \
  roles/cloudtasks.enqueuer \
  roles/storage.objectAdmin \
  roles/firebase.sdkAdminServiceAgent \
  roles/iam.serviceAccountTokenCreator; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:$SA" --role="$ROLE"
done

# Create Cloud Tasks queue
gcloud tasks queues create clip-note-jobs \
  --location=us-central1 \
  --max-attempts=3 \
  --min-backoff=10s || true

# Create Cloud Storage bucket
gsutil mb -l us-central1 gs://clip-note-media-${PROJECT} || true
gsutil iam ch allUsers:objectViewer gs://clip-note-media-${PROJECT}

echo "Done. Project: $PROJECT"
echo "Next: Enable Firebase + Firestore in console, then set GOOGLE_CLOUD_PROJECT=$PROJECT in backend/.env"
```

- [ ] **Step 1.4: Write infra/firestore.rules**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /notes/{noteId} {
      allow read, delete: if request.auth != null && request.auth.uid == resource.data.user_id;
      allow create: if false; // backend only
      allow update: if false; // backend only
    }
    match /jobs/{jobId} {
      allow read: if request.auth != null && request.auth.uid == resource.data.user_id;
      allow write: if false; // backend only
    }
    match /usage/{docId} {
      allow read, write: if false; // backend only (per-user daily rate-limit counters)
    }
    match /system/{docId} {
      allow read, write: if false; // backend only (global daily kill-switch counter)
    }
  }
}
```
Note: `users/{uid}` now also holds a `categories` array (read/written by the backend; the user-scoped
rule above already permits the owner to read it).

- [ ] **Step 1.5: Write infra/firestore.indexes.json**
```json
{
  "indexes": [
    {
      "collectionGroup": "notes",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "user_id", "order": "ASCENDING"},
        {"fieldPath": "created_at", "order": "DESCENDING"}
      ]
    },
    {
      "collectionGroup": "notes",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "user_id", "order": "ASCENDING"},
        {"fieldPath": "content_type", "order": "ASCENDING"},
        {"fieldPath": "created_at", "order": "DESCENDING"}
      ]
    },
    {
      "collectionGroup": "jobs",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "user_id", "order": "ASCENDING"},
        {"fieldPath": "created_at", "order": "DESCENDING"}
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 1.6: Write backend/requirements.txt**
```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.8.0
firebase-admin>=6.5.0
google-auth>=2.30.0
google-genai>=1.0.0
google-cloud-aiplatform>=1.60.0
google-cloud-tasks>=2.16.0
google-cloud-storage>=2.17.0
yt-dlp>=2024.8.1
httpx>=0.27.0
beautifulsoup4>=4.12.0
python-multipart>=0.0.9
python-dotenv>=1.0.1
```

- [ ] **Step 1.7: Write backend/config.py**
```python
import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    PROJECT_NAME = "Clip Note API"
    VERSION = "1.0.0"

    GOOGLE_CLOUD_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    GOOGLE_CLOUD_LOCATION: str = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")

    # Confirm these IDs against the live Vertex AI catalog before first run.
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    GEMINI_LITE_MODEL: str = os.getenv("GEMINI_LITE_MODEL", "gemini-2.5-flash-lite")
    IMAGEN_MODEL: str = os.getenv("IMAGEN_MODEL", "imagen-3.0-generate-002")

    CLOUD_TASKS_QUEUE: str = os.getenv("CLOUD_TASKS_QUEUE", "clip-note-jobs")
    CLOUD_TASKS_LOCATION: str = os.getenv("CLOUD_TASKS_LOCATION", "us-central1")
    CLOUD_TASKS_WORKER_URL: str = os.getenv("CLOUD_TASKS_WORKER_URL", "http://localhost:8080")
    # OIDC, not a shared secret: tasks are signed by this SA; the worker validates the token.
    CLOUD_TASKS_SA_EMAIL: str = os.getenv("CLOUD_TASKS_SA_EMAIL", "")

    CLOUD_STORAGE_BUCKET: str = os.getenv("CLOUD_STORAGE_BUCKET", "")

    TEMP_DOWNLOAD_DIR: str = os.getenv("TEMP_DOWNLOAD_DIR", "/tmp/clip_note_downloads")

    # Cost guardrails (budget ~$360 total).
    MAX_NOTES_PER_USER: int = int(os.getenv("MAX_NOTES_PER_USER", "500"))
    MAX_INGESTS_PER_USER_PER_DAY: int = int(os.getenv("MAX_INGESTS_PER_USER_PER_DAY", "50"))
    DAILY_GLOBAL_NOTE_CAP: int = int(os.getenv("DAILY_GLOBAL_NOTE_CAP", "1000"))

    # Video handling: transcript-first; only short videos fall back to media analysis.
    MAX_VIDEO_SECONDS: int = int(os.getenv("MAX_VIDEO_SECONDS", "1200"))  # 20 min

    # Content types that warrant an Imagen-generated cover when none is found.
    VISUAL_CONTENT_TYPES: set[str] = {"recipe", "product", "itinerary", "travel", "place", "fashion"}

    # Imagen-generated covers are DEFERRED for MVP — og:image fallback + gradient
    # placeholder is enough. Flip ENABLE_IMAGEN=true only after validating users care about covers.
    ENABLE_IMAGEN: bool = os.getenv("ENABLE_IMAGEN", "false").lower() == "true"

settings = Settings()
```

- [ ] **Step 1.8: Create backend/.env.example**
```
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
GEMINI_LITE_MODEL=gemini-2.5-flash-lite
CLOUD_TASKS_QUEUE=clip-note-jobs
CLOUD_TASKS_LOCATION=us-central1
CLOUD_TASKS_WORKER_URL=https://clip-note-api-xxx.run.app
CLOUD_TASKS_SA_EMAIL=clip-note-sa@your-project.iam.gserviceaccount.com
CLOUD_STORAGE_BUCKET=clip-note-media-your-project
TEMP_DOWNLOAD_DIR=/tmp/clip_note_downloads
ENABLE_IMAGEN=false
```

- [ ] **Step 1.9: Commit**
```bash
git add infra/ backend/requirements.txt backend/config.py backend/.env.example
git commit -m "feat: project scaffold, GCP infra scripts, backend config"
```

---

## Task 2: Backend — Firebase service + models

**Files:**
- Create: `backend/services/firebase.py`
- Create: `backend/models/note.py`

- [ ] **Step 2.1: Write backend/services/firebase.py**
```python
import asyncio
import firebase_admin
from firebase_admin import auth, firestore
from google.cloud.firestore_v1 import AsyncClient, ArrayUnion

_app = None
_db: AsyncClient | None = None

def get_firebase_app():
    global _app
    if _app is None:
        # On Cloud Run: uses Application Default Credentials automatically
        _app = firebase_admin.initialize_app()
    return _app

def get_db() -> AsyncClient:
    """Singleton Firestore async client (do NOT create a new client per request)."""
    global _db
    if _db is None:
        get_firebase_app()
        _db = firestore.AsyncClient()
    return _db

async def verify_firebase_token(token: str) -> str:
    """Verifies a Firebase ID token and returns the user's uid. Runs the blocking
    SDK call off the event loop."""
    get_firebase_app()
    decoded = await asyncio.to_thread(auth.verify_id_token, token)
    return decoded["uid"]

async def get_user_categories(uid: str) -> list[str]:
    """Returns the user's known content_type slugs from users/{uid}.categories
    (one doc read — no notes-collection scan)."""
    db = get_db()
    snap = await db.collection("users").document(uid).get()
    if not snap.exists:
        return []
    return sorted(snap.to_dict().get("categories", []))

async def add_user_category(uid: str, slug: str) -> None:
    """Adds a content_type slug to users/{uid}.categories (idempotent via ArrayUnion)."""
    db = get_db()
    await db.collection("users").document(uid).set(
        {"categories": ArrayUnion([slug])}, merge=True
    )
```

- [ ] **Step 2.2: Write backend/models/note.py**
```python
from typing import Any, Optional
from pydantic import BaseModel

class IngestRequest(BaseModel):
    url: str
    content: str | None = None   # pre-extracted text (paywall/auth bypass via PWA/shortcut)
    source: str = "web"          # "web" | "shortcut" | "pwa"

class NoteExtraction(BaseModel):
    content_type: str
    title: str
    ai_summary: str
    cover_image_prompt: str
    data: dict[str, Any]  # structured fields only — rendered by React templates, never HTML

class JobStatus(BaseModel):
    job_id: str
    status: str  # pending | processing | completed | failed
    note_id: Optional[str] = None
    error: Optional[str] = None
```

- [ ] **Step 2.3: Commit**
```bash
git add backend/services/firebase.py backend/models/note.py
git commit -m "feat: Firebase admin service, Firestore helpers, note models"
```

---

## Task 3: Backend — Gemini two-step pipeline

**Files:**
- Create: `backend/services/gemini.py`

> **Phase 1 refinement — type-specific extraction prompts.** The `EXTRACTION_SYSTEM` below carries
> every type's schema in one mega-prompt. Once Step 1 has assigned the category, load a *focused*
> prompt for just that type (a `TYPE_PROMPTS: dict[str, str]` keyed by slug, falling back to the
> generic-building-blocks instructions for AI-invented types) and pass only that schema to
> `analyze_text`/`analyze_media`. This produces better-targeted output and spends fewer input tokens
> per note. Keep the generic-blocks instructions as the default branch for unknown slugs.

- [ ] **Step 3.1: Write backend/services/gemini.py**
```python
import asyncio
import json
import re
from typing import Any
from google import genai
from google.genai import types
from config import settings
from models.note import NoteExtraction


def normalize_slug(raw: str) -> str:
    """lowercase-kebab-case, trimmed."""
    s = re.sub(r"[^a-z0-9]+", "-", (raw or "").lower()).strip("-")
    return s or "general"


def match_existing(slug: str, existing: list[str]) -> str:
    """Collapse to an existing category if it's effectively the same (case/space/plural)."""
    norm = normalize_slug(slug)
    by_norm = {normalize_slug(c): c for c in existing}
    if norm in by_norm:
        return by_norm[norm]
    # crude singular/plural convergence (recipe ↔ recipes)
    for cand in (norm.rstrip("s"), norm + "s"):
        if cand in by_norm:
            return by_norm[cand]
    return norm

CATEGORY_SYSTEM = """You assign a content category to a URL.
Return ONLY valid JSON: {"content_type": "slug"}
The slug must be lowercase-kebab-case.
Prefer an existing category if the content clearly fits.
Create a new slug only if nothing fits well."""

EXTRACTION_SYSTEM = """You are a note extraction engine.
Goal: extract a note so complete the user never needs the source again.
Output is STRUCTURED JSON ONLY — no HTML, no markup, no styling. The frontend renders it.

Top-level fields:
  content_type: the slug provided to you (echo it back; do not change it)
  title: concise note title
  ai_summary: 2 conversational, specific sentences about this content
  cover_image_prompt: a vivid visual scene to generate a cover image if none is found
  data: the structured payload, per the schema for the content_type below

`data` schemas for known types:
recipe → {totalTime, servings, difficulty, ingredients: [{group?, items: [str]}], steps: [str]}
itinerary → {destination, duration, budget, days: [{day, title, stops: [{time, place, note}]}]}
product → {price, brand, rating (0-5 float), buyUrl, specs: [{label, value}], pros: [str], cons: [str]}
summary → {medium: "article"|"video", readTime?, videoLength?, tldr: str, keyPoints: [str], quotes: [{text, timestamp?}]}

For any OTHER (AI-invented) content_type, design the most useful FLAT, RENDERABLE `data` shape using
only these generic building blocks, which the GenericNote template knows how to render:
  - "sections": [{ "heading": str, "items": [str] }]          ← headed bullet lists
  - "facts":    [{ "label": str, "value": str }]              ← key/value rows
  - "steps":    [str]                                          ← ordered steps
  - "quotes":   [{ "text": str, "attribution"?: str }]
Prefer these keys so any note renders well without a bespoke template.

Respond as JSON only."""


class GeminiService:
    def __init__(self):
        self.client = genai.Client(
            vertexai=True,
            project=settings.GOOGLE_CLOUD_PROJECT,
            location=settings.GOOGLE_CLOUD_LOCATION,
        )

    async def assign_category(self, url: str, content_preview: str, existing_categories: list[str]) -> str:
        """Step 1: Cheap lite-model call to assign or create a category slug."""
        categories_str = ", ".join(existing_categories) if existing_categories else "none yet"
        prompt = (
            f"URL: {url}\n"
            f"Content preview: {content_preview[:500]}\n"
            f"User's existing categories: {categories_str}\n"
            "Choose the best content_type category."
        )
        response = await asyncio.to_thread(
            self.client.models.generate_content,
            model=settings.GEMINI_LITE_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                system_instruction=CATEGORY_SYSTEM,
                max_output_tokens=50,
            ),
        )
        result = json.loads(response.text)
        # Normalize and converge with the user's existing categories to avoid
        # duplicates like recipe/recipes/cooking.
        return match_existing(result.get("content_type", "general"), existing_categories)

    def analyze_text(self, text_content: str, source_url: str, content_type: str) -> NoteExtraction:
        """Step 2: Full structured extraction (JSON `data` only) using the main model."""
        prompt = (
            f"URL: {source_url}\n"
            f"content_type: {content_type}\n\n"
            f"Content:\n{text_content[:28000]}"
        )
        response = self.client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=NoteExtraction,
                system_instruction=EXTRACTION_SYSTEM,
            ),
        )
        parsed = NoteExtraction.model_validate_json(response.text)
        parsed.content_type = content_type  # enforce Step 1 decision
        return parsed

    def analyze_media(self, file_path: str, source_url: str, content_type: str, metadata: dict) -> NoteExtraction:
        """Step 2 for video/audio: inline bytes to Vertex AI."""
        import mimetypes
        mime_type = mimetypes.guess_type(file_path)[0] or "video/mp4"
        with open(file_path, "rb") as f:
            file_bytes = f.read()
        file_part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
        prompt = (
            f"URL: {source_url}\n"
            f"content_type: {content_type}\n"
            f"Platform: {metadata.get('platform', 'video')}\n"
            f"Author: {metadata.get('author', 'unknown')}"
        )
        response = self.client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[file_part, prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=NoteExtraction,
                system_instruction=EXTRACTION_SYSTEM,
            ),
        )
        parsed = NoteExtraction.model_validate_json(response.text)
        parsed.content_type = content_type
        return parsed


gemini_service = GeminiService()
```

- [ ] **Step 3.2: Commit**
```bash
git add backend/services/gemini.py
git commit -m "feat: Gemini two-step pipeline (category + extraction with HTML)"
```

---

## Task 4: Backend — Imagen + Cloud Tasks + Scraper + Downloader

**Files:**
- Create: `backend/services/imagen.py`
- Create: `backend/services/cloud_tasks.py`
- Create: `backend/services/scraper.py`
- Create: `backend/services/downloader.py`

- [ ] **Step 4.1: Write backend/services/imagen.py**
> **Confirm the import path before relying on this.** `vertexai.preview.vision_models` is a
> *preview* namespace and may move. Verify against the installed `google-cloud-aiplatform` version
> whether the stable path (`vertexai.vision_models import ImageGenerationModel`) is available and
> prefer it. A wrong/relocated import fails at first call. Imagen is also gated off by default for
> MVP (`ENABLE_IMAGEN=false`), so this is only exercised once covers are turned on.

```python
import uuid
from google.cloud import storage
from google.cloud import aiplatform
from vertexai.preview.vision_models import ImageGenerationModel
from config import settings

def generate_cover_image(prompt: str) -> str | None:
    """Generates a cover image and uploads to Cloud Storage. Returns public URL or None."""
    if not settings.CLOUD_STORAGE_BUCKET:
        return None
    try:
        aiplatform.init(project=settings.GOOGLE_CLOUD_PROJECT, location=settings.GOOGLE_CLOUD_LOCATION)
        model = ImageGenerationModel.from_pretrained(settings.IMAGEN_MODEL)
        images = model.generate_images(
            prompt=prompt,
            number_of_images=1,
            aspect_ratio="16:9",
        )
        if not images:
            return None

        image_bytes = images[0]._image_bytes
        blob_name = f"covers/{uuid.uuid4()}.png"

        storage_client = storage.Client()
        bucket = storage_client.bucket(settings.CLOUD_STORAGE_BUCKET)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(image_bytes, content_type="image/png")
        # No blob.make_public() — the bucket uses uniform bucket-level access and is granted
        # allUsers:objectViewer in infra/setup.sh, so per-object ACLs would error. The public
        # URL is well-formed for a publicly-readable bucket.
        return f"https://storage.googleapis.com/{settings.CLOUD_STORAGE_BUCKET}/{blob_name}"
    except Exception as e:
        print(f"Imagen generation failed: {e}")
        return None
```
> Imagen is only invoked for visual content types with no found cover (see the process router) —
> it is a real cost line, not a default.

- [ ] **Step 4.2: Write backend/services/cloud_tasks.py**
```python
import json
from google.cloud import tasks_v2
from config import settings

def enqueue_process_job(job_id: str, user_id: str, url: str) -> None:
    """Enqueues a Cloud Task to process the job in the background."""
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.GOOGLE_CLOUD_PROJECT,
        settings.CLOUD_TASKS_LOCATION,
        settings.CLOUD_TASKS_QUEUE,
    )
    worker_url = f"{settings.CLOUD_TASKS_WORKER_URL}/api/process/{job_id}"
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": worker_url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"job_id": job_id, "user_id": user_id, "url": url}).encode(),
            # OIDC token: Cloud Tasks signs the request as the service account; the worker
            # verifies the token's signature, issuer, audience, and email. No shared secret.
            "oidc_token": {
                "service_account_email": settings.CLOUD_TASKS_SA_EMAIL,
                "audience": settings.CLOUD_TASKS_WORKER_URL,
            },
        }
    }
    client.create_task(parent=parent, task=task)
```

- [ ] **Step 4.3: Write backend/services/scraper.py**
```python
import httpx
from bs4 import BeautifulSoup
from typing import TypedDict

class ScrapeResult(TypedDict):
    title: str
    text: str
    thumbnail_url: str | None
    first_image_url: str | None

HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
}

async def scrape_url(url: str) -> ScrapeResult:
    """Scrapes a webpage. Returns title, body text, og:image, and first significant img."""
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(url, headers=HEADERS)
        if response.status_code != 200:
            return {"title": "Untitled", "text": "", "thumbnail_url": None, "first_image_url": None}

        soup = BeautifulSoup(response.text, "html.parser")

        title = "Untitled"
        if t := soup.find("meta", property="og:title"):
            title = t.get("content", "Untitled")
        elif soup.title and soup.title.string:
            title = soup.title.string.strip()
        elif h1 := soup.find("h1"):
            title = h1.get_text().strip()

        thumbnail_url: str | None = None
        for prop in ("og:image", "twitter:image"):
            if tag := (soup.find("meta", property=prop) or soup.find("meta", attrs={"name": prop})):
                thumbnail_url = tag.get("content")
                break

        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]):
            tag.decompose()

        content_area = soup.find("article") or soup.find("main") or soup.body
        paragraphs = content_area.find_all(["p", "h1", "h2", "h3", "h4", "li"]) if content_area else []
        text_parts = [p.get_text().strip() for p in paragraphs if len(p.get_text().strip()) > 15]
        full_text = "\n\n".join(text_parts)[:28000]

        first_image_url: str | None = None
        if not thumbnail_url and content_area:
            for img in content_area.find_all("img"):
                src = img.get("src", "")
                if src.startswith("http") and not src.endswith(".svg"):
                    w = img.get("width", "")
                    if not w or (w.isdigit() and int(w) > 100):
                        first_image_url = src
                        break

        return {"title": title, "text": full_text, "thumbnail_url": thumbnail_url, "first_image_url": first_image_url}

    except Exception as e:
        print(f"Scraper error for {url}: {e}")
        return {"title": "Untitled", "text": "", "thumbnail_url": None, "first_image_url": None}
```

- [ ] **Step 4.4: Write backend/services/downloader.py**
```python
import os
import yt_dlp
from typing import TypedDict
from config import settings

os.makedirs(settings.TEMP_DOWNLOAD_DIR, exist_ok=True)

VIDEO_DOMAINS = {"youtube.com", "youtu.be", "tiktok.com", "instagram.com", "twitter.com", "x.com", "reddit.com"}

def is_video_url(url: str) -> bool:
    url_lower = url.lower()
    return any(d in url_lower for d in VIDEO_DOMAINS)

class VideoInfo(TypedDict):
    title: str
    author: str | None
    platform: str
    thumbnail_url: str | None
    duration: int          # seconds (0 if unknown)
    transcript: str | None # captions/auto-subs joined to text, if available

class DownloadResult(TypedDict):
    file_path: str | None
    title: str
    author: str | None
    platform: str
    thumbnail_url: str | None


def _extract_transcript(info: dict) -> str | None:
    """Pulls manual or auto captions (English-ish) from yt-dlp info and returns plain text."""
    import httpx, json as _json
    tracks = (info.get("subtitles") or {}) or (info.get("automatic_captions") or {})
    if not tracks:
        return None
    lang = next((l for l in tracks if l.startswith("en")), next(iter(tracks), None))
    if not lang:
        return None
    fmts = tracks[lang]
    pick = next((f for f in fmts if f.get("ext") in ("json3", "vtt", "srv1")), fmts[0] if fmts else None)
    if not pick or not pick.get("url"):
        return None
    try:
        raw = httpx.get(pick["url"], timeout=15.0).text
    except Exception:
        return None
    if pick.get("ext") == "json3":
        try:
            events = _json.loads(raw).get("events", [])
            words = [seg.get("utf8", "") for ev in events for seg in (ev.get("segs") or [])]
            text = "".join(words)
        except Exception:
            return None
    else:  # vtt/srt-ish: drop timestamp/index lines
        lines = [ln.strip() for ln in raw.splitlines()
                 if ln.strip() and "-->" not in ln and not ln.strip().isdigit()
                 and not ln.startswith(("WEBVTT", "Kind:", "Language:"))]
        text = " ".join(lines)
    text = text.strip()
    return text[:28000] if text else None


def probe_video(url: str) -> VideoInfo:
    """Metadata-only probe (no download): title, duration, thumbnail, and transcript if captions exist."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True,
            "writesubtitles": True, "writeautomaticsub": True, "subtractlangs": ["en.*"]}
    empty: VideoInfo = {"title": "Untitled", "author": None, "platform": "video",
                        "thumbnail_url": None, "duration": 0, "transcript": None}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            return empty
        return {
            "title": info.get("title", "Untitled"),
            "author": info.get("uploader") or info.get("creator"),
            "platform": (info.get("extractor_key") or "video").lower(),
            "thumbnail_url": info.get("thumbnail"),
            "duration": int(info.get("duration") or 0),
            "transcript": _extract_transcript(info),
        }
    except Exception as e:
        print(f"yt-dlp probe failed for {url}: {e}")
        return empty


def download_media(url: str) -> DownloadResult:
    """Downloads media with yt-dlp (only used as a fallback for SHORT, transcript-less videos)."""
    ydl_opts = {
        "format": "bestvideo[height<=480]+bestaudio/best[height<=480]/worst",
        "outtmpl": os.path.join(settings.TEMP_DOWNLOAD_DIR, "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "merge_output_format": "mp4",
        "overwrites": True,
    }
    empty: DownloadResult = {"file_path": None, "title": "Untitled", "author": None, "platform": "video", "thumbnail_url": None}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if not info:
                return empty
            filename = ydl.prepare_filename(info)
            base = os.path.splitext(filename)[0]
            file_path = None
            for ext in ("mp4", "mkv", "webm", "m4a"):
                p = f"{base}.{ext}"
                if os.path.exists(p):
                    file_path = p
                    break
            if not file_path and os.path.exists(filename):
                file_path = filename

            platform = (info.get("extractor_key") or "video").lower()
            return {
                "file_path": file_path,
                "title": info.get("title", "Untitled"),
                "author": info.get("uploader") or info.get("creator"),
                "platform": platform,
                "thumbnail_url": info.get("thumbnail"),
            }
    except Exception as e:
        print(f"yt-dlp failed for {url}: {e}")
        return empty

def cleanup_file(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass
```

- [ ] **Step 4.5: Commit**
```bash
git add backend/services/imagen.py backend/services/cloud_tasks.py \
        backend/services/scraper.py backend/services/downloader.py
git commit -m "feat: Imagen, Cloud Tasks, scraper, downloader services"
```

---

## Task 5: Backend — Ingest router (fast path)

**Files:**
- Create: `backend/routers/ingest.py`

- [ ] **Step 5.1: Write backend/routers/ingest.py**
```python
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header
from google.cloud import firestore as fs
from config import settings
from models.note import IngestRequest, JobStatus
from services.firebase import verify_firebase_token, get_db
from services.cloud_tasks import enqueue_process_job

router = APIRouter(tags=["ingest"])

async def _resolve_user(authorization: str | None) -> str:
    """Resolves user_id from the Firebase Bearer token."""
    if authorization and authorization.startswith("Bearer "):
        try:
            return await verify_firebase_token(authorization.removeprefix("Bearer "))
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid Firebase token")
    raise HTTPException(status_code=401, detail="Authentication required")

async def _enforce_cost_caps(db, user_id: str) -> None:
    """Per-user daily ingest cap, per-user note cap, and a global daily kill-switch.
    Raises 429 when a limit is hit. Counters are transactional increments."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")

    # Per-user note cap (aggregation count — cheap, server-side).
    notes_q = db.collection("notes").where("user_id", "==", user_id)
    note_count = (await notes_q.count().get())[0][0].value
    if note_count >= settings.MAX_NOTES_PER_USER:
        raise HTTPException(429, "Note limit reached for this account.")

    @fs.async_transactional
    async def _bump(tx):
        user_ref = db.collection("usage").document(f"{user_id}-{today}")
        global_ref = db.collection("system").document(f"usage-{today}")
        user_snap = await user_ref.get(transaction=tx)
        global_snap = await global_ref.get(transaction=tx)
        user_n = (user_snap.to_dict() or {}).get("ingest_count", 0)
        global_n = (global_snap.to_dict() or {}).get("note_count", 0)
        if user_n >= settings.MAX_INGESTS_PER_USER_PER_DAY:
            raise HTTPException(429, "Daily limit reached. Try again tomorrow.")
        if global_n >= settings.DAILY_GLOBAL_NOTE_CAP:
            raise HTTPException(429, "Service is at capacity today. Try again tomorrow.")
        tx.set(user_ref, {"user_id": user_id, "date": today, "ingest_count": user_n + 1}, merge=True)
        tx.set(global_ref, {"date": today, "note_count": global_n + 1}, merge=True)

    await _bump(db.transaction())

@router.post("/ingest", response_model=JobStatus)
async def ingest(
    body: IngestRequest,
    authorization: str | None = Header(default=None),
):
    user_id = await _resolve_user(authorization)

    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid URL")

    db = get_db()
    await _enforce_cost_caps(db, user_id)

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    await db.collection("jobs").document(job_id).set({
        "user_id": user_id,
        "url": body.url,
        "content": body.content,   # pre-extracted text from PWA/shortcut, if any
        "source": body.source,     # "web" | "shortcut" | "pwa"
        "status": "pending",
        "note_id": None,
        "error": None,
        "attempt_count": 0,
        "created_at": now,
        "updated_at": now,
    })

    # content/source are read back off the job doc by the worker — no need to inflate the task payload.
    enqueue_process_job(job_id, user_id, body.url)

    return JobStatus(job_id=job_id, status="pending")
```

- [ ] **Step 5.2: Commit**
```bash
git add backend/routers/ingest.py
git commit -m "feat: ingest router — returns job_id in ~50ms, enqueues Cloud Task"
```

---

## Task 6: Backend — Process router (Cloud Tasks worker)

**Files:**
- Create: `backend/routers/process.py`

- [ ] **Step 6.1: Write backend/routers/process.py**
```python
import asyncio
import os
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from google.cloud import firestore as fs
from config import settings
from services.firebase import get_db, get_user_categories, add_user_category
from services.gemini import gemini_service
from services.imagen import generate_cover_image
from services.scraper import scrape_url
from services.downloader import is_video_url, probe_video, download_media, cleanup_file

router = APIRouter(tags=["process"])

def _verify_oidc(request: Request) -> None:
    """Validates the Cloud Tasks OIDC token: signature, audience (worker URL), and SA email."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(403, "Forbidden")
    try:
        claims = id_token.verify_oauth2_token(
            auth.removeprefix("Bearer "),
            google_requests.Request(),
            audience=settings.CLOUD_TASKS_WORKER_URL,
        )
    except Exception:
        raise HTTPException(403, "Forbidden")
    if claims.get("email") != settings.CLOUD_TASKS_SA_EMAIL or not claims.get("email_verified"):
        raise HTTPException(403, "Forbidden")

@router.post("/process/{job_id}")
async def process_job(job_id: str, request: Request):
    _verify_oidc(request)

    db = get_db()
    job_ref = db.collection("jobs").document(job_id)
    job_snap = await job_ref.get()
    if not job_snap.exists:
        # Permanent: return 200 so Cloud Tasks does not retry a vanished job.
        return {"status": "missing"}

    job = job_snap.to_dict()
    # Idempotency: a retry of an already-finished job must not redo paid AI work.
    if job.get("status") == "completed":
        return {"status": "completed", "note_id": job.get("note_id")}

    user_id: str = job["user_id"]
    url: str = job["url"]
    content: str | None = job.get("content")   # device-extracted text (PWA/shortcut), if any
    source: str = job.get("source", "web")
    now = datetime.now(timezone.utc)
    await job_ref.update({"status": "processing", "attempt_count": fs.Increment(1), "updated_at": now})

    file_path = None
    try:
        cover_image_url: str | None = None
        content_preview = ""
        text_content = ""        # always defined → no NameError if a video branch fails
        use_media = False

        if content:
            # Device-side extraction (PWA "Get Text" / shortcut) already stripped HTML and
            # bypassed any paywall/auth wall — skip the scraper entirely.
            text_content = content[:30000]
            content_preview = text_content[:300]
        elif is_video_url(url):
            info = await asyncio.to_thread(probe_video, url)
            cover_image_url = info["thumbnail_url"]
            content_preview = f"{info['title']} by {info['author'] or 'unknown'}"
            if info["transcript"]:
                # Transcript-first: cheapest, no inline-bytes limit.
                text_content = info["transcript"]
            elif 0 < info["duration"] <= settings.MAX_VIDEO_SECONDS:
                # Short, no captions → download and analyze media as a fallback.
                result = await asyncio.to_thread(download_media, url)
                file_path = result["file_path"]
                use_media = bool(file_path and os.path.exists(file_path))
                if not use_media:
                    text_content = content_preview  # last-resort: metadata only
            else:
                # Too long / no transcript → metadata-only note, no expensive media call.
                text_content = content_preview
        else:
            scraped = await scrape_url(url)
            cover_image_url = scraped["thumbnail_url"] or scraped["first_image_url"]
            content_preview = scraped["title"] + " " + scraped["text"][:300]
            text_content = scraped["text"] or scraped["title"]

        # Step 1: cheap category assignment (normalized + converged with existing categories).
        existing_categories = await get_user_categories(user_id)
        content_type = await gemini_service.assign_category(url, content_preview, existing_categories)

        # Step 2: structured extraction (data only — no HTML). Sync SDK → run off the loop.
        if use_media:
            extracted = await asyncio.to_thread(
                gemini_service.analyze_media, file_path, url, content_type,
                {"platform": url.split("/")[2], "author": content_preview},
            )
        else:
            extracted = await asyncio.to_thread(
                gemini_service.analyze_text, text_content, url, content_type
            )

        # Output validation: refuse to persist an empty/too-thin extraction — mark the job failed
        # with a clear error instead of saving a broken note (the except below records it).
        if not extracted.data or len(str(extracted.data)) < 40:
            raise ValueError("Extraction produced empty or suspiciously short data")

        # Imagen fallback only for visual content types with no found cover — and only when covers
        # are enabled (deferred for MVP; ENABLE_IMAGEN=false). og:image/gradient placeholder otherwise.
        if (settings.ENABLE_IMAGEN and not cover_image_url and extracted.cover_image_prompt
                and content_type in settings.VISUAL_CONTENT_TYPES):
            cover_image_url = await asyncio.to_thread(generate_cover_image, extracted.cover_image_prompt)

        source_domain = url.split("/")[2].replace("www.", "") if "://" in url else url

        note_id = str(uuid.uuid4())
        await db.collection("notes").document(note_id).set({
            "user_id": user_id,
            "content_type": extracted.content_type,
            "title": extracted.title,
            "ai_summary": extracted.ai_summary,
            "source_url": url,
            "source_domain": source_domain,
            "source": source,              # "web" | "shortcut" | "pwa"
            "cover_image_url": cover_image_url,
            "data": extracted.data,        # structured only — no rendered_html
            "created_at": now,
            "updated_at": now,
        })
        await add_user_category(user_id, extracted.content_type)
        await job_ref.update({"status": "completed", "note_id": note_id, "updated_at": datetime.now(timezone.utc)})
        return {"status": "completed", "note_id": note_id}

    except Exception as e:
        # Mark failed and return 200: a retry would just re-spend on the same failing input.
        print(f"Process job {job_id} failed: {e}")
        await job_ref.update({"status": "failed", "error": str(e), "updated_at": datetime.now(timezone.utc)})
        return {"status": "failed", "error": str(e)}

    finally:
        cleanup_file(file_path)
```

- [ ] **Step 6.2: Commit**
```bash
git add backend/routers/process.py
git commit -m "feat: process router — full async pipeline with category assignment"
```

---

## Task 7: Backend — Notes, Jobs routers + shared auth dep + main.py + Dockerfile

**Files:**
- Create: `backend/services/auth_dep.py`
- Create: `backend/routers/notes.py`
- Create: `backend/routers/jobs.py`
- Create: `backend/main.py`
- Create: `backend/Dockerfile`

> The iOS Shortcut + Personal Access Token routes are built in **Phase 2** (Track B), not here —
> see the Phase 2 task block after Task 14. Phase 1 ships the web "+ capture" flow only.

- [ ] **Step 7.0: Write backend/services/auth_dep.py** (one shared dependency — no per-router `_auth` copies)
```python
from fastapi import Header, HTTPException
from services.firebase import verify_firebase_token

async def require_user(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: returns the authenticated uid or raises 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    try:
        return await verify_firebase_token(authorization.removeprefix("Bearer "))
    except Exception:
        raise HTTPException(401, "Invalid token")
```

- [ ] **Step 7.1: Write backend/routers/notes.py**
```python
from fastapi import APIRouter, Depends, HTTPException
from services.firebase import get_db
from services.auth_dep import require_user

router = APIRouter(tags=["notes"])

@router.get("/notes")
async def list_notes(user_id: str = Depends(require_user)):
    db = get_db()
    query = db.collection("notes").where("user_id", "==", user_id).order_by("created_at", direction="DESCENDING")
    notes = []
    async for doc in query.stream():
        notes.append({"id": doc.id, **doc.to_dict()})
    return notes

@router.get("/notes/{note_id}")
async def get_note(note_id: str, user_id: str = Depends(require_user)):
    db = get_db()
    doc = await db.collection("notes").document(note_id).get()
    if not doc.exists or doc.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    return {"id": doc.id, **doc.to_dict()}

@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user_id: str = Depends(require_user)):
    db = get_db()
    doc = await db.collection("notes").document(note_id).get()
    if not doc.exists or doc.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Note not found")
    await db.collection("notes").document(note_id).delete()
    return {"status": "deleted"}

@router.delete("/notes")
async def delete_all_notes(user_id: str = Depends(require_user)):
    """Clears all notes for the authenticated user (settings 'danger zone')."""
    db = get_db()
    batch = db.batch()
    count = 0
    async for doc in db.collection("notes").where("user_id", "==", user_id).stream():
        batch.delete(doc.reference)
        count += 1
        if count % 499 == 0:
            await batch.commit()
            batch = db.batch()
    await batch.commit()  # always commit the final batch (committing an empty batch is a no-op)
    return {"deleted": count}
```

- [ ] **Step 7.2: Write backend/routers/jobs.py**
```python
from fastapi import APIRouter, Depends, HTTPException
from services.firebase import get_db
from services.auth_dep import require_user

router = APIRouter(tags=["jobs"])

@router.get("/jobs")
async def list_jobs(user_id: str = Depends(require_user)):
    db = get_db()
    query = db.collection("jobs").where("user_id", "==", user_id).order_by("created_at", direction="DESCENDING").limit(50)
    jobs = []
    async for doc in query.stream():
        jobs.append({"id": doc.id, **doc.to_dict()})
    return jobs

@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user_id: str = Depends(require_user)):
    db = get_db()
    doc = await db.collection("jobs").document(job_id).get()
    if not doc.exists or doc.to_dict().get("user_id") != user_id:
        raise HTTPException(404, "Job not found")
    return {"id": doc.id, **doc.to_dict()}
```

- [ ] **Step 7.3: (Phase 2) iOS Shortcut + PAT router** — built in the Phase 2 task block (Track B), not in Phase 1. Skip here.

- [ ] **Step 7.4: Write backend/main.py**
```python
import os
import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings

os.makedirs(settings.TEMP_DOWNLOAD_DIR, exist_ok=True)

app = FastAPI(title=settings.PROJECT_NAME, version=settings.VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        # Add Firebase Hosting URL after deploy
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    print(traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": str(exc)})

@app.get("/health")
def health():
    return {"status": "healthy", "version": settings.VERSION}

from routers.ingest import router as ingest_router
from routers.process import router as process_router
from routers.notes import router as notes_router
from routers.jobs import router as jobs_router

app.include_router(ingest_router, prefix="/api")
app.include_router(process_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
```

- [ ] **Step 7.5: Write backend/Dockerfile**
```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV TEMP_DOWNLOAD_DIR=/tmp/clip_note_downloads
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 7.6: Test backend locally**

Install deps and run:
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in GOOGLE_CLOUD_PROJECT at minimum
uvicorn main:app --reload --port 8080
```

Expected: `GET http://localhost:8080/health` → `{"status":"healthy","version":"1.0.0"}`

- [ ] **Step 7.7: Commit**
```bash
git add backend/routers/ backend/main.py backend/Dockerfile
git commit -m "feat: all backend routers, Dockerfile — backend complete"
```

---

## Task 8: Frontend — Remove Lovable, new vite.config, Firebase client

**Files:**
- Modify: `frontend/package.json`
- Replace: `frontend/vite.config.ts`
- Delete: `frontend/.lovable/`, `frontend/src/lib/lovable-error-reporting.ts`, `frontend/src/integrations/supabase/`
- Create: `frontend/src/integrations/firebase/client.ts`
- Create: `frontend/src/integrations/firebase/auth-middleware.ts`
- Create: `frontend/.env`

- [ ] **Step 8.1: Remove Lovable files**
```bash
rm -rf frontend/.lovable
rm -f frontend/src/lib/lovable-error-reporting.ts
rm -rf frontend/src/integrations/supabase
```

- [ ] **Step 8.2: Update frontend/package.json**

Remove from `devDependencies`: `"@lovable.dev/vite-tanstack-config"`
Remove from `dependencies`: `"@supabase/supabase-js"`
Add to `dependencies`:
```json
"firebase": "^11.0.0"
```
(No `dompurify` — notes render via React templates from structured `data`, not injected HTML.)

- [ ] **Step 8.3: Write frontend/vite.config.ts**
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    TanStackRouterVite({ autoCodeSplitting: true }),
    tailwindcss(),
    react(),
  ],
  server: { port: 3000 },
})
```

- [ ] **Step 8.4: Write frontend/src/integrations/firebase/client.ts**
```ts
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
```

- [ ] **Step 8.5: Write frontend/src/integrations/firebase/auth-middleware.ts**
```ts
import { auth } from './client'

export async function getAuthHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser
  if (!user) return {}
  const token = await user.getIdToken()
  return { Authorization: `Bearer ${token}` }
}
```

- [ ] **Step 8.6: Create frontend/.env**
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_API_URL=http://localhost:8080
```
Fill in Firebase values from Firebase Console → Project Settings → Your apps → Web app config.

- [ ] **Step 8.7: Install deps and verify build starts**
```bash
cd frontend
npm install
npm run dev
```
Expected: dev server starts on http://localhost:3000 (may show errors — next tasks fix them)

- [ ] **Step 8.8: Commit**
```bash
git add frontend/
git commit -m "feat: remove Lovable branding, install Firebase, custom vite config"
```

---

## Task 9: Frontend — Auth context, login page, protected routes, types

**Files:**
- Create: `frontend/src/contexts/auth-context.tsx`
- Create: `frontend/src/routes/login.tsx`
- Create: `frontend/src/lib/types.ts`
- Modify: `frontend/src/routes/__root.tsx`

- [ ] **Step 9.1: Write frontend/src/contexts/auth-context.tsx**
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { type User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut } from 'firebase/auth'
import { auth } from '@/integrations/firebase/client'

interface AuthCtx {
  user: User | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthCtx>({
  user: null, loading: true,
  signInWithGoogle: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, new GoogleAuthProvider())
  }

  const signOut = async () => {
    await firebaseSignOut(auth)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

- [ ] **Step 9.2: Write frontend/src/lib/types.ts**
```ts
export interface Note {
  id: string
  content_type: string
  title: string
  ai_summary: string
  source_url: string
  source_domain: string
  cover_image_url: string | null
  data: Record<string, unknown>
  created_at: { seconds: number; nanoseconds: number }
  updated_at: { seconds: number; nanoseconds: number }
}

export interface Job {
  id: string
  user_id: string
  url: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  note_id: string | null
  error: string | null
  attempt_count: number
  created_at: { seconds: number; nanoseconds: number }
}
```

- [ ] **Step 9.3: Write frontend/src/routes/login.tsx**
```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useEffect } from 'react'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { user, loading, signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user) navigate({ to: '/' })
  }, [user, loading, navigate])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-ink text-paper">
          <Sparkles className="h-8 w-8" />
        </div>
        <h1 className="font-serif text-4xl text-ink">Clipnote</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Your saved recipes, products, and articles — structured and searchable,
          not buried in a bookmark graveyard.
        </p>
        <button
          onClick={signInWithGoogle}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-full bg-ink px-6 py-3.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 9.4: Update frontend/src/routes/__root.tsx**

Replace the file entirely:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Outlet, Link, createRootRouteWithContext, useRouter, useNavigate } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import appCss from '../styles.css?url'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/instrument-serif/400.css'
import { AuthProvider, useAuth } from '@/contexts/auth-context'

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-7xl text-ink">404</h1>
        <h2 className="mt-4 font-serif text-2xl text-ink">Note not found</h2>
        <p className="mt-2 text-sm text-ink-soft">That link doesn't lead anywhere in your notebook.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90">
            Back to notes
          </Link>
        </div>
      </div>
    </div>
  )
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter()
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl text-ink">Something went sideways</h1>
        <p className="mt-2 text-sm text-ink-soft">We couldn't load this page. Try again or head home.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset() }} className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90">
            Try again
          </button>
          <a href="/" className="inline-flex items-center justify-center rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-accent">
            Go home
          </a>
        </div>
      </div>
    </div>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  links: () => [{ rel: 'stylesheet', href: appCss }],
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </AuthProvider>
  )
}
```

- [ ] **Step 9.5: Commit**
```bash
git add frontend/src/
git commit -m "feat: auth context, login page, types, updated root layout"
```

---

## Task 10: Frontend — Firestore data layer + API client

**Files:**
- Create: `frontend/src/lib/firestore.ts`
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 10.1: Write frontend/src/lib/firestore.ts**
```ts
import {
  collection, query, where, orderBy, limit, getDocs, getDoc,
  doc, onSnapshot, type Unsubscribe,
} from 'firebase/firestore'
import { db } from '@/integrations/firebase/client'
import type { Note, Job } from '@/lib/types'

export async function getNotes(userId: string): Promise<Note[]> {
  const q = query(
    collection(db, 'notes'),
    where('user_id', '==', userId),
    orderBy('created_at', 'desc'),
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Note))
}

// Real-time feed: notes appear/update without a manual refetch. `max` paginates the
// initial window (raise it via a "load more" control). Returns an unsubscribe fn.
export function watchNotes(
  userId: string,
  callback: (notes: Note[]) => void,
  max = 30,
): Unsubscribe {
  const q = query(
    collection(db, 'notes'),
    where('user_id', '==', userId),
    orderBy('created_at', 'desc'),
    limit(max),
  )
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Note)))
  })
}

export async function getNote(noteId: string): Promise<Note | null> {
  const snap = await getDoc(doc(db, 'notes', noteId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Note
}

export function watchJob(
  jobId: string,
  callback: (job: Partial<Job>) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'jobs', jobId), (snap) => {
    if (snap.exists()) callback(snap.data() as Partial<Job>)
  })
}

export async function getUserCategories(userId: string): Promise<string[]> {
  // One doc read against users/{uid}.categories — never scan the whole notes collection.
  const snap = await getDoc(doc(db, 'users', userId))
  return snap.exists() ? ((snap.data().categories ?? []) as string[]).sort() : []
}
```

- [ ] **Step 10.2: Write frontend/src/lib/api.ts**
```ts
import { getAuthHeader } from '@/integrations/firebase/auth-middleware'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

export async function ingest(url: string): Promise<{ job_id: string; status: string }> {
  const headers = await getAuthHeader()
  const res = await fetch(`${API_URL}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ url }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? 'Ingest failed')
  }
  return res.json()
}

export async function deleteAllNotes(): Promise<void> {
  const headers = await getAuthHeader()
  await fetch(`${API_URL}/api/notes`, { method: 'DELETE', headers })
}
```

- [ ] **Step 10.3: Commit**
```bash
git add frontend/src/lib/firestore.ts frontend/src/lib/api.ts
git commit -m "feat: Firestore data layer, API client with auth header"
```

---

## Task 11: Frontend — NoteContent renderer (typed templates + GenericNote) + updated capture modal

**Files:**
- Create: `frontend/src/components/NoteContent.tsx`
- Create: `frontend/src/components/note/templates/GenericNote.tsx`
- Keep: `RecipeNote.tsx`, `ItineraryNote.tsx`, `ProductNote.tsx`, `SummaryNote.tsx` (adapt to read `note.data`)
- Modify: `frontend/src/components/CaptureModal.tsx`

- [ ] **Step 11.1: Keep the existing templates; adapt their props to the `Note.data` shape**

The Lovable templates already exist and are well-designed. Keep all four and change them to read from
the typed `note.data` map (e.g. `RecipeNote` reads `data.ingredients`, `data.steps`, etc.), matching
the `data` schemas in `EXTRACTION_SYSTEM`. Do **not** delete them — they are the renderer.

- [ ] **Step 11.2: Write frontend/src/components/note/templates/GenericNote.tsx** (fallback for AI-invented types)
```tsx
import type { Note } from '@/lib/types'

// Renders the generic building blocks the model is told to emit for unknown types:
// sections [{heading, items[]}], facts [{label, value}], steps [string], quotes [{text, attribution?}]
export function GenericNote({ data }: { data: Record<string, unknown> }) {
  const sections = (data.sections as { heading: string; items: string[] }[]) ?? []
  const facts = (data.facts as { label: string; value: string }[]) ?? []
  const steps = (data.steps as string[]) ?? []
  const quotes = (data.quotes as { text: string; attribution?: string }[]) ?? []

  return (
    <div className="space-y-10">
      {facts.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5">
          {facts.map((f, i) => (
            <div key={i} className="flex justify-between border-b border-border py-2 last:border-0">
              <span className="text-sm text-ink-soft">{f.label}</span>
              <span className="text-sm font-medium text-ink">{f.value}</span>
            </div>
          ))}
        </section>
      )}
      {sections.map((s, i) => (
        <section key={i} className="space-y-4">
          <h2 className="font-serif text-2xl text-ink">{s.heading}</h2>
          <ul className="space-y-3">
            {s.items.map((it, j) => (
              <li key={j} className="flex items-start gap-3 text-ink">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-soft" />
                <span>{it}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {steps.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-serif text-2xl text-ink">Steps</h2>
          <ol className="space-y-4">
            {steps.map((st, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-medium text-paper">{i + 1}</span>
                <p className="pt-0.5 leading-relaxed text-ink">{st}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {quotes.map((q, i) => (
        <blockquote key={i} className="rounded-2xl border border-border bg-card p-5">
          <p className="font-serif text-lg leading-snug text-ink">“{q.text}”</p>
          {q.attribution && <div className="mt-2 text-xs text-ink-soft">{q.attribution}</div>}
        </blockquote>
      ))}
    </div>
  )
}
```

- [ ] **Step 11.3: Write frontend/src/components/NoteContent.tsx** (switch on `content_type`, no HTML injection)
```tsx
import type { Note } from '@/lib/types'
import { NoteHeader } from './note/NoteHeader'
import { AISummaryBlock } from './note/AISummaryBlock'
import { RecipeNote } from './note/templates/RecipeNote'
import { ItineraryNote } from './note/templates/ItineraryNote'
import { ProductNote } from './note/templates/ProductNote'
import { SummaryNote } from './note/templates/SummaryNote'
import { GenericNote } from './note/templates/GenericNote'

function renderBody(note: Note) {
  switch (note.content_type) {
    case 'recipe': return <RecipeNote data={note.data} />
    case 'itinerary': return <ItineraryNote data={note.data} />
    case 'product': return <ProductNote data={note.data} />
    case 'summary': return <SummaryNote data={note.data} />
    default: return <GenericNote data={note.data} />   // any AI-invented type
  }
}

export function NoteContent({ note }: { note: Note }) {
  return (
    <article className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-14">
      <NoteHeader note={note} />
      {note.cover_image_url && (
        <div className="mb-8 overflow-hidden rounded-3xl border border-border">
          <img src={note.cover_image_url} alt="" className="h-72 w-full object-cover md:h-96" />
        </div>
      )}
      <AISummaryBlock summary={note.ai_summary} />
      <div className="mt-8">{renderBody(note)}</div>
    </article>
  )
}
```

- [ ] **Step 11.3: Rewrite frontend/src/components/CaptureModal.tsx**
```tsx
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Sparkles, X, Link2, AlertCircle } from 'lucide-react'
import { ingest } from '@/lib/api'
import { watchJob } from '@/lib/firestore'

const stages = [
  'Fetching the page…',
  'Reading the content…',
  'Detecting structure…',
  'Drafting your note…',
]

export function CaptureModal({ url, onClose }: { url: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [stage, setStage] = useState(0)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    stages.forEach((_, i) => {
      timers.push(setTimeout(() => setStage(i), i * 700))
    })

    ingest(url)
      .then(({ job_id }) => {
        unsubRef.current = watchJob(job_id, (job) => {
          if (job.status === 'completed' && job.note_id) {
            unsubRef.current?.()
            setDone(true)
            setTimeout(() => navigate({ to: '/notes/$noteId', params: { noteId: job.note_id! } }), 600)
          } else if (job.status === 'failed') {
            unsubRef.current?.()
            setError(job.error ?? 'Processing failed. Please try again.')
          }
        })
      })
      .catch((e) => setError(e.message))

    return () => {
      timers.forEach(clearTimeout)
      unsubRef.current?.()
    }
  }, [url, navigate])

  let domain = ''
  try { domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '') }
  catch { domain = url }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-accent hover:text-ink" aria-label="Close">
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 rounded-2xl border border-border bg-paper p-3">
          {domain ? (
            <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`} alt="" className="h-8 w-8 rounded-md" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted"><Link2 className="h-4 w-4 text-ink-soft" /></div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{domain || 'Source'}</div>
            <div className="truncate text-xs text-ink-soft">{url}</div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <div className="mt-6">
            <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
              <Sparkles className={`h-3.5 w-3.5 ${done ? '' : 'animate-pulse'}`} />
              {done ? 'Done' : 'AI at work'}
            </div>
            <ul className="mt-3 space-y-2">
              {stages.map((label, i) => {
                const active = i === stage && !done
                const complete = i < stage || done
                return (
                  <li key={i} className="flex items-center gap-3">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${complete ? 'bg-ink text-paper' : active ? 'bg-summary-soft text-summary' : 'bg-muted text-ink-soft'}`}>
                      {complete ? '✓' : i + 1}
                    </span>
                    <span className={`text-sm transition-colors ${complete ? 'text-ink-soft line-through' : active ? 'text-ink' : 'text-ink-soft'}`}>
                      {label}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 11.4: Commit**
```bash
git add frontend/src/components/
git commit -m "feat: NoteContent HTML renderer, real CaptureModal with job listener"
```

---

## Task 12: Frontend — Home feed + Note detail + Settings

**Files:**
- Replace: `frontend/src/routes/index.tsx`
- Replace: `frontend/src/routes/notes.$noteId.tsx`
- Replace: `frontend/src/routes/settings.tsx`

- [ ] **Step 12.1: Rewrite frontend/src/routes/index.tsx**
```tsx
import { useMemo, useState, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Search, Sparkles, Plus } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { watchNotes } from '@/lib/firestore'
import { NoteCard } from '@/components/NoteCard'
import { CaptureModal } from '@/components/CaptureModal'
import { AppShell } from '@/components/AppShell'
import type { Note } from '@/lib/types'

export const Route = createFileRoute('/')({ component: Feed })

function Feed() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [notes, setNotes] = useState<Note[]>([])
  const [active, setActive] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [captureUrl, setCaptureUrl] = useState<string | null>(null)
  const [showCapture, setShowCapture] = useState(false)
  const [pendingUrl, setPendingUrl] = useState('')

  useEffect(() => {
    if (!loading && !user) navigate({ to: '/login' })
  }, [user, loading, navigate])

  // Real-time feed: new/updated notes appear without a manual refetch.
  useEffect(() => {
    if (!user) return
    const unsub = watchNotes(user.uid, setNotes)
    return unsub
  }, [user])

  const categories = useMemo(() => Array.from(new Set(notes.map(n => n.content_type))).sort(), [notes])

  const filtered = useMemo(() => {
    return notes.filter(n => {
      if (active !== 'all' && n.content_type !== active) return false
      if (query.trim()) {
        const q = query.toLowerCase()
        return n.title.toLowerCase().includes(q) || n.ai_summary.toLowerCase().includes(q)
      }
      return true
    })
  }, [notes, active, query])

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Sparkles className="h-6 w-6 animate-pulse text-ink-soft" /></div>

  return (
    <AppShell>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 pt-4 pb-3 md:px-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink text-paper">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-serif text-2xl text-ink">Clipnote</span>
          </div>
          <label className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5">
            <Search className="h-4 w-4 text-ink-soft" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your notes" className="w-full bg-transparent text-base outline-none placeholder:text-ink-soft md:text-sm" />
          </label>
          <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {[{ id: 'all', label: 'All' }, ...categories.map(c => ({ id: c, label: c.replace(/-/g, ' ') }))].map(f => (
              <button key={f.id} type="button" onClick={() => setActive(f.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm capitalize transition-colors ${active === f.id ? 'bg-ink text-paper' : 'border border-border bg-card text-ink-soft hover:text-ink'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-5 md:px-6">
        {filtered.length === 0 ? <EmptyState /> : (
          <section className="grid gap-4 sm:grid-cols-2">
            {filtered.map(n => <NoteCard key={n.id} note={n} />)}
          </section>
        )}
      </main>

      <button type="button" onClick={() => { setPendingUrl(''); setShowCapture(true) }}
        aria-label="Add note"
        className="fixed bottom-20 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-transform active:scale-95 md:bottom-8">
        <Plus className="h-6 w-6" />
      </button>

      {showCapture && !captureUrl && (
        <AddSheet url={pendingUrl} setUrl={setPendingUrl} onCancel={() => setShowCapture(false)}
          onSubmit={u => { setCaptureUrl(u); setShowCapture(false) }} />
      )}
      {captureUrl && (
        <CaptureModal url={captureUrl} onClose={() => setCaptureUrl(null)} />
        // No manual refetch — watchNotes() streams the new note into the feed live.
      )}
    </AppShell>
  )
}

function AddSheet({ url, setUrl, onCancel, onSubmit }: { url: string; setUrl: (v: string) => void; onCancel: () => void; onSubmit: (u: string) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm md:items-center md:p-4">
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-2xl md:rounded-3xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
        <h2 className="font-serif text-2xl text-ink">New note</h2>
        <p className="mt-1 text-sm text-ink-soft">Paste any link — article, reel, recipe, product.</p>
        <form onSubmit={e => { e.preventDefault(); if (url.trim()) onSubmit(url.trim()) }} className="mt-4 space-y-3">
          <input autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" inputMode="url" autoComplete="off" spellCheck={false}
            className="w-full rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink" />
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-border bg-card px-4 py-3 text-sm font-medium text-ink">Cancel</button>
            <button type="submit" disabled={!url.trim()} className="flex-1 rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper disabled:opacity-50">Capture</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-summary-soft">
        <Sparkles className="h-5 w-5 text-summary" />
      </div>
      <h3 className="mt-4 font-serif text-2xl text-ink">No notes yet</h3>
      <p className="mt-2 text-sm text-ink-soft">Tap + to clip your first link.</p>
    </div>
  )
}
```

- [ ] **Step 12.2: Rewrite frontend/src/routes/notes.$noteId.tsx** (create if it doesn't exist as `notes_.$noteId.tsx` or similar)
```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { getNote } from '@/lib/firestore'
import { useAuth } from '@/contexts/auth-context'
import { NoteContent } from '@/components/NoteContent'
import { AppShell } from '@/components/AppShell'
import type { Note } from '@/lib/types'

export const Route = createFileRoute('/notes/$noteId')({ component: NoteDetail })

function NoteDetail() {
  const { noteId } = Route.useParams()
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [note, setNote] = useState<Note | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!loading && !user) navigate({ to: '/login' })
  }, [user, loading, navigate])

  useEffect(() => {
    if (user && noteId) {
      getNote(noteId).then(n => {
        if (!n || n.user_id !== user.uid) setNotFound(true)
        else setNote(n)
      })
    }
  }, [user, noteId])

  if (loading || (!note && !notFound)) {
    return <div className="flex min-h-screen items-center justify-center"><Sparkles className="h-6 w-6 animate-pulse text-ink-soft" /></div>
  }
  if (notFound) {
    return <div className="flex min-h-screen items-center justify-center text-ink-soft">Note not found.</div>
  }

  return (
    <AppShell>
      <NoteContent note={note!} />
    </AppShell>
  )
}
```

- [ ] **Step 12.3: Rewrite frontend/src/routes/settings.tsx** (create the route file)
```tsx
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LogOut, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { deleteAllNotes } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

export const Route = createFileRoute('/settings')({ component: Settings })

function Settings() {
  const { user, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    if (!loading && !user) navigate({ to: '/login' })
  }, [user, loading, navigate])

  const handleSignOut = async () => {
    await signOut()
    navigate({ to: '/login' })
  }

  const handleClearNotes = async () => {
    if (!clearConfirm) { setClearConfirm(true); return }
    setClearing(true)
    try {
      await deleteAllNotes()
      navigate({ to: '/' })
    } finally {
      setClearing(false)
      setClearConfirm(false)
    }
  }

  if (loading) return null

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
        <h1 className="font-serif text-3xl text-ink">Settings</h1>

        {/* Profile */}
        <section className="mt-8 rounded-3xl border border-border bg-card p-6">
          <h2 className="text-xs uppercase tracking-wider text-ink-soft">Profile</h2>
          <div className="mt-4 flex items-center gap-4">
            {user?.photoURL && <img src={user.photoURL} alt="" className="h-14 w-14 rounded-full" />}
            <div>
              <div className="font-medium text-ink">{user?.displayName}</div>
              <div className="text-sm text-ink-soft">{user?.email}</div>
            </div>
          </div>
        </section>

        {/* "Connect iPhone" (PAT generation + connected-devices list) is added in Phase 2, Track B. */}

        {/* Sign out */}
        <section className="mt-4 rounded-3xl border border-border bg-card p-6">
          <h2 className="text-xs uppercase tracking-wider text-ink-soft">Account</h2>
          <button
            onClick={handleSignOut}
            className="mt-4 flex items-center gap-2 text-sm text-ink hover:text-ink-soft"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </section>

        {/* Danger zone */}
        <section className="mt-4 rounded-3xl border border-destructive/30 bg-card p-6">
          <h2 className="text-xs uppercase tracking-wider text-destructive">Danger zone</h2>
          <p className="mt-2 text-sm text-ink-soft">This permanently deletes all your notes. Cannot be undone.</p>
          <button
            onClick={handleClearNotes}
            disabled={clearing}
            className={`mt-4 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${clearConfirm ? 'bg-destructive text-white' : 'border border-destructive/30 text-destructive hover:bg-destructive/10'}`}
          >
            <Trash2 className="h-4 w-4" />
            {clearing ? 'Clearing…' : clearConfirm ? 'Tap again to confirm' : 'Clear all notes'}
          </button>
        </section>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 12.4: Update NoteCard to use Note type from Firestore**

`frontend/src/components/NoteCard.tsx` — update the import to use `Note` from `@/lib/types` instead of `mock-notes`. The card renders `note.title`, `note.ai_summary`, `note.cover_image_url`, `note.content_type`, `note.source_domain`. Adapt field names to match the new `Note` interface (e.g., `content_type` instead of `type`, `ai_summary` instead of `aiSummary`, `cover_image_url` instead of `cover`, `source_domain` instead of `source.domain`).

- [ ] **Step 12.5: Commit**
```bash
git add frontend/src/routes/ frontend/src/components/
git commit -m "feat: home feed, note detail, settings page — all wired to Firestore"
```

---

## Task 13: Frontend — Firebase Hosting config + final build test

**Files:**
- Create: `frontend/firebase.json`
- Create: `frontend/.firebaserc`

- [ ] **Step 13.1: Write frontend/firebase.json**
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

- [ ] **Step 13.2: Write frontend/.firebaserc**
```json
{
  "projects": {
    "default": "YOUR_FIREBASE_PROJECT_ID"
  }
}
```
Replace `YOUR_FIREBASE_PROJECT_ID` with the actual Firebase project ID.

- [ ] **Step 13.3: Test local build**
```bash
cd frontend
npm run build
```
Expected: `dist/` directory created with `index.html` and assets. No TypeScript errors.

- [ ] **Step 13.4: Commit**
```bash
git add frontend/firebase.json frontend/.firebaserc
git commit -m "feat: Firebase Hosting config, SPA rewrites"
```

---

## Task 14: Deployment

- [ ] **Step 14.1: Bootstrap GCP (run once)**
```bash
bash infra/setup.sh YOUR_GCP_PROJECT_ID
```
Expected output: APIs enabled, service account created with all roles, Cloud Tasks queue created, Cloud Storage bucket created.

- [ ] **Step 14.2: Set up Firebase + Firestore in console**
1. Go to console.firebase.google.com → Add project (or import existing GCP project)
2. Enable Firestore Database → Native mode → us-central1
3. Enable Authentication → Sign-in providers → Google → Enable
4. Go to Project Settings → Your apps → Add Web app → Copy config to `frontend/.env`

- [ ] **Step 14.3: Deploy Firestore rules and indexes**
```bash
cd infra
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore:rules --only firestore:indexes
```

- [ ] **Step 14.4: Deploy backend to Cloud Run**
```bash
# Build and push
gcloud builds submit --tag gcr.io/YOUR_PROJECT/clip-note-api ./backend

# Deploy
gcloud run deploy clip-note-api \
  --image gcr.io/YOUR_PROJECT/clip-note-api \
  --platform managed \
  --region us-central1 \
  --service-account clip-note-sa@YOUR_PROJECT.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --timeout 600 \
  --memory 1Gi \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=YOUR_PROJECT,\
CLOUD_TASKS_QUEUE=clip-note-jobs,\
CLOUD_TASKS_LOCATION=us-central1,\
CLOUD_TASKS_WORKER_URL=https://clip-note-api-YOUR_HASH.run.app,\
CLOUD_TASKS_SA_EMAIL=clip-note-sa@YOUR_PROJECT.iam.gserviceaccount.com,\
CLOUD_STORAGE_BUCKET=clip-note-media-YOUR_PROJECT"
```
Notes:
- `--allow-unauthenticated` exposes the public/front-end routes; `/api/process` is protected by the
  in-app **OIDC** check (token signed by `CLOUD_TASKS_SA_EMAIL`, audience = the worker URL). No shared
  secret. The SA already has `roles/iam.serviceAccountTokenCreator` (from `infra/setup.sh`) to mint the token.
- `--timeout 600 --memory 1Gi` covers the short-video download fallback; long videos use the
  transcript path and never download.
- After deploy, note the URL → set `CLOUD_TASKS_WORKER_URL` (redeploy) and `frontend/.env` `VITE_API_URL`.
- Set a **GCP billing budget alert** now (the in-app caps are the primary guard; this is the backstop).

- [ ] **Step 14.5: Update CORS in main.py**

Add the Firebase Hosting URL to the CORS `allow_origins` list in `backend/main.py`, then redeploy.

- [ ] **Step 14.6: Deploy frontend**
```bash
cd frontend
npm run build
firebase deploy --only hosting
```

- [ ] **Step 14.7: Commit**
```bash
git add .
git commit -m "feat: deployment configuration complete"
```

---

## Phase 2: Capture — make clipping a reflex (MVP, two tracks)

The web "+ capture" flow ships in Phase 1. Phase 2 makes capture frictionless from the share sheet.
Two independent tracks; ship Track A first (broadest reach), then Track B for iOS power users.

### Track A — PWA Web Share Target (Android + iOS Safari, ~2–3 days)

- [ ] **Step 2A.1: Add a `share_target` to `frontend/public/manifest.json`**
```json
"share_target": {
  "action": "/share",
  "method": "GET",
  "params": { "url": "url", "text": "text", "title": "title" }
}
```
- [ ] **Step 2A.2: Add a `/share` route** (`frontend/src/routes/share.tsx`) that reads `?url=` (falling
  back to `?text=` when a platform puts the link there), then opens the capture flow pre-filled with
  that URL — same `CaptureModal` path as the manual "+ capture". Redirect to `/` afterward.
- [ ] **Step 2A.3:** Confirm the app is installable (valid manifest + service worker) so the OS share
  sheet lists Clip Note. Verify share from Android Chrome opens the pre-filled capture modal.

### Track B — iOS Shortcut + Personal Access Token system (~2 days)

**Backend:**

- [ ] **Step 2B.1: New collection `shortcut_tokens/{token_id}`** — `{user_id, token_hash (bcrypt),
  label, created_at, last_used_at}`. **Store bcrypt hashes, never raw tokens.** Add `bcrypt` to
  `requirements.txt`. Lock the collection in `firestore.rules` to backend-only (`allow read, write: if false`).
- [ ] **Step 2B.2: Token routes** (`routers/tokens.py`, `Depends(require_user)`):
  - `POST /api/tokens` → generates a `cn_`-prefixed random token, stores its bcrypt hash + label,
    returns the **raw token exactly once**.
  - `GET /api/tokens` → returns labels + `last_used_at` only (never the token or hash).
  - `DELETE /api/tokens/{id}` → revokes.
- [ ] **Step 2B.3: Make `require_user` accept both token types** (`services/auth_dep.py`):
```python
if authorization.startswith("Bearer ey"):      # Firebase JWT
    return await verify_firebase_token(...)
elif authorization.startswith("Bearer cn_"):    # Personal Access Token
    return await verify_pat(...)                 # bcrypt-check against shortcut_tokens; bump last_used_at
```
  `verify_pat` looks up the token's hash, checks bcrypt, updates `last_used_at`, returns `user_id`.
- [ ] **Step 2B.4: `GET /api/shortcut/version`** → `{current, min_supported}` so the shortcut can prompt
  for updates without a manual reinstall.
- [ ] **Step 2B.5: Separate, stricter rate-limit bucket for PAT requests** (distinct from the
  Firebase-user daily ingest cap) in `/api/ingest`.

**Shortcut (configuration, not code):**

1. Receive share input → "Get Contents of Web Page" → "Get Text" (strips HTML, bypasses paywalls
   **on-device** — this is why the shortcut sends `content`, not just `url`).
2. "Get Contents of URL" → POST `/api/ingest` with the PAT in `Authorization` and the extracted
   `content` in the body (`source: "shortcut"`). Runs silently — **never** "Open URL".
3. Native notification on success; native alert on 429/error.

**Frontend setup flow:**

- [ ] **Step 2B.6: Settings "Connect iPhone"** generates a token server-side, then deep-links to
  `shortcuts://run-shortcut?name=Clip%20Note%20Setup&input=TOKEN`. The setup shortcut stores the token
  in the iOS **Keychain** (16.4+) or a Shortcuts global variable. **Avoid Data Jar** (paid third-party
  dependency).
- [ ] **Step 2B.7: Connected-devices list in Settings** — show each token's label, created, and last-used,
  with one-tap revoke (calls `DELETE /api/tokens/{id}`).

- [ ] **Step 2B.8: Commit** Phase 2 backend + frontend.

---

## Phase 3: Monetization + retention (before public launch)

> Hard rule: do not launch publicly until this phase is done.

### Paywall

- [ ] **Step 3.1: Add `plan: "free" | "pro"` to `users/{uid}`** (default `"free"` on first write).
- [ ] **Step 3.2: Enforce note limits in `/api/ingest`** — free = 20 notes/month, pro = unlimited.
  On cap hit, return a **structured HTTP 402** (e.g. `{"detail": "...", "code": "plan_limit"}`) the
  frontend catches and turns into an upgrade prompt (distinct from the 429 cost-cap path).
- [ ] **Step 3.3: Stripe Checkout (~1 day)** — checkout session + one webhook that flips
  `users/{uid}.plan = "pro"` on successful payment. Store `stripe_customer_id` on the user doc.
- [ ] **Step 3.4: Frontend upgrade prompt** — catch the 402 in `lib/api.ts`, surface an upgrade
  modal that links to Checkout.

### Retention

- [ ] **Step 3.5: Weekly digest email** — Cloud Scheduler → a Cloud Run endpoint that, per user, sends
  "Here's what you saved this week" (last 5 notes) via SendGrid free tier. No personalization needed.

**Pricing rationale:** per note ≈ $0.05–0.15; 100 notes ≈ $5–15 of AI cost → **pro ≈ $7–9/month**.
The existing per-user caps, global kill switch, and billing alert stay in place as backstops even with
the paywall.

- [ ] **Step 3.6: Commit** paywall + digest.

---

## Phase 4: Search + growth (first month of usage)

- [ ] **Step 4.1: Full-text search via Typesense Cloud (free tier).** On note creation, index
  `{id, title, ai_summary, content_type, source_domain}`. Add `POST /api/search`. This **replaces the
  client-side substring match**, which breaks past ~50 notes. Point the feed search box at `/api/search`.
- [ ] **Step 4.2: Public shareable notes.** Add `is_public: false` to the note schema; a "Share" button
  flips it. `/p/{note_id}` renders read-only **without auth**, with an og:image. Firestore rule:
```
allow read: if resource.data.is_public == true
            || (request.auth != null && request.auth.uid == resource.data.user_id);
```
  The og:image preview requires **SSR** — move the note-detail render to Cloud Run (or use a prerender
  service as a stopgap), since the Phase 1 frontend is a static SPA.
- [ ] **Step 4.3: Commit** search + public notes.

---

## Phase 5: Native app (after web validation)

- [ ] **Step 5.1:** Wrap the web app in **Expo** + `expo-share-extension` to ship a native iOS Share
  Extension. It appears in the share row by default and removes the Shortcuts install friction.
  **Don't start until web users are actively saving via the Phase 2 shortcut** — this is gated on real
  usage, not a checklist item to rush.

---

## Verification Checklist

- [ ] 1. App loads at Firebase Hosting URL, Google Sign-In works, profile photo shows in Settings
- [ ] 2. `POST /api/ingest` with YouTube URL → `{job_id}` returned in < 500ms
- [ ] 3. Firestore console: job doc transitions `pending → processing → completed`
- [ ] 4. Note appears in the home feed **without a refresh** (real-time `watchNotes` `onSnapshot`)
- [ ] 5. Clip two recipe URLs → both land in one `recipe` category (slug normalized/converged, no `recipe` + `recipes`)
- [ ] 6. Clip an unknown-content URL → a new `content_type` slug is invented and the note renders via `GenericNote` from structured `data` (no HTML stored on the note doc)
- [ ] 7. Clip a **recipe/product** URL with no og:image → Imagen cover appears in the bucket; a **non-visual** URL with no image gets a gradient placeholder (no Imagen call)
- [ ] 8. Settings → Clear all notes → feed becomes empty (live)
- [ ] 9. `GET /api/jobs` with auth header → returns past jobs with status
- [ ] 10. **Cost caps:** exceeding the per-user daily ingest cap (or note cap) returns HTTP 429 from `/api/ingest`
- [ ] 11. **Security:** `POST /api/process/{job_id}` without a valid OIDC token returns 403; a Cloud-Tasks-signed call succeeds
- [ ] 12. **Idempotency:** re-POSTing `/api/process` for an already-completed job is a no-op (no second note, no extra AI spend)
- [ ] 13. **Long video:** a 20-min+ video produces a transcript-based note (no inline-bytes failure, no media download)
- [ ] 14. **Phase 0 gate:** AI output quality on the 20–30 sample URLs judged acceptable before any build
- [ ] 15. **PWA share (Track A):** sharing from Android Chrome opens the capture modal pre-filled
- [ ] 16. **iOS shortcut (Track B):** running it on a paywalled article sends device-extracted `content` and produces a complete note
- [ ] 17. **PAT auth:** a valid PAT ingests successfully; a revoked PAT returns 401
- [ ] 18. **Paywall:** a free user at 20 notes gets a structured 402 + upgrade prompt; a pro user is uncapped
- [ ] 19. **Digest:** the weekly digest email fires and links back into the app
- [ ] 20. **Search:** returns a note by a word in its body/summary, not just its title
- [ ] 21. **Public note:** `/p/{id}` renders without auth and shows a correct og:image preview when shared

---

## Post-MVP backlog

Most of what was here is now scheduled into the phase plan above (iOS shortcut → Phase 2; public
share pages → Phase 4; search → Phase 4; native apps → Phase 5). What remains genuinely deferred:

- **Resurfacing / reminders.** Surface old notes back to the user on a schedule.
- **User-owned collections.** Manual grouping on top of the AI-assigned `content_type`.
- **Android native app.** After the iOS native app (Phase 5) is validated.
- **Imagen-generated covers at scale.** Gated off for MVP (`ENABLE_IMAGEN=false`); enable only once
  there's evidence users value generated covers.
