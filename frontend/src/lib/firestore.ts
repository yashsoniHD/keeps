import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDoc,
  setDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import type { Note, Job } from "@/lib/types";

// Record signup attribution on the user's own doc (rules allow owner writes). Merge so it
// never clobbers backend-written fields; called once, on first sign-in.
export async function recordSignup(uid: string, ref: string | null): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    { signup_ref: ref || "direct", signup_at: serverTimestamp() },
    { merge: true },
  );
}

// Real-time feed: notes appear/update without a manual refetch. Returns an unsubscribe fn.
// contentType filters server-side via the (user_id, content_type, created_at) composite
// index, so a filtered view reaches past the feed window instead of slicing loaded docs.
export function watchNotes(
  userId: string,
  callback: (notes: Note[]) => void,
  opts: {
    max?: number;
    // A single slug (==) or a group of slugs (Firestore `in`, capped at 10) that all render
    // as the same chip label — see the category-chip dedupe in the feed.
    contentType?: string | string[];
    onError?: (e: Error) => void;
  } = {},
): Unsubscribe {
  const { max = 50, contentType, onError } = opts;
  const types = contentType ? (Array.isArray(contentType) ? contentType : [contentType]) : [];
  const clauses = [
    where("user_id", "==", userId),
    ...(types.length === 1
      ? [where("content_type", "==", types[0])]
      : types.length > 1
        ? [where("content_type", "in", types.slice(0, 10))]
        : []),
    orderBy("created_at", "desc"),
    limit(max),
  ];
  const q = query(collection(db, "notes"), ...clauses);
  return onSnapshot(
    q,
    (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Note));
    },
    (err) => onError?.(err),
  );
}

export async function getNote(noteId: string): Promise<Note | null> {
  const snap = await getDoc(doc(db, "notes", noteId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Note;
}

export function watchJob(jobId: string, callback: (job: Partial<Job>) => void): Unsubscribe {
  return onSnapshot(doc(db, "jobs", jobId), (snap) => {
    if (snap.exists()) callback(snap.data() as Partial<Job>);
  });
}

// How long a failed job stays visible in the feed (it can also be dismissed).
const FAILED_JOB_TTL_MS = 6 * 60 * 60 * 1000;

// A `pending` job that never advances is orphaned — a backend enqueue failure or a network
// partition dropped the capture, so no worker will ever pick it up. Past this age we stop
// rendering it as an immortal "Saving…" placeholder and surface it through the failed-card path
// instead (dismissible + retryable). `processing`/`deferred` are real live states — left alone.
const STALE_PENDING_MS = 10 * 60 * 1000;

// In-flight + recently-failed captures: drives the "processing" and "failed" cards in
// the feed. Reuses the existing (user_id, created_at) jobs index — a freshly created job
// always has the newest created_at, so the most-recent slice is guaranteed to include any
// pending one. Completed jobs never render (the note card replaces them); failed jobs
// surface for a few hours so a capture never just vanishes without an explanation.
export function watchPendingJobs(
  userId: string,
  callback: (jobs: Job[]) => void,
  max = 15,
): Unsubscribe {
  const q = query(
    collection(db, "jobs"),
    where("user_id", "==", userId),
    orderBy("created_at", "desc"),
    limit(max),
  );
  return onSnapshot(q, (snap) => {
    const now = Date.now();
    const failedCutoff = now - FAILED_JOB_TTL_MS;
    const jobs: Job[] = [];
    for (const d of snap.docs) {
      const j = { id: d.id, ...d.data() } as Job;
      const ts = (j.updated_at ?? j.created_at)?.toMillis() ?? now;
      if (j.status === "pending") {
        if (now - ts > STALE_PENDING_MS) {
          // Orphaned pending job → present as failed so the feed shows a dismissible/retryable
          // card instead of "Saving…" forever. No failed-TTL gate: these were never explicitly
          // marked failed, so they render until dismissed or they fall out of the recent window.
          jobs.push({ ...j, status: "failed", error: j.error || "Capture didn't go through" });
        } else {
          jobs.push(j); // still fresh — a genuine in-flight capture
        }
      } else if (j.status === "processing" || j.status === "deferred") {
        // deferred = parked by the global cap — shown as "Queued"
        jobs.push(j);
      } else if (j.status === "failed" && ts > failedCutoff) {
        jobs.push(j);
      }
    }
    callback(jobs);
  });
}

// One doc read against users/{uid}.categories — never scan the notes collection.
export async function getUserCategories(userId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? ((snap.data().categories ?? []) as string[]).sort() : [];
}

// kebab-case a label into a category slug, matching the backend's normalize_slug.
export function slugifyCategory(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function getOnboardingDone(userId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() && snap.data().onboarding_done === true;
}

export async function setOnboardingDone(userId: string): Promise<void> {
  await setDoc(doc(db, "users", userId), { onboarding_done: true }, { merge: true });
}

// The user's region (ISO-3166-1 alpha-2) — feeds streaming availability and reservation
// links on enriched notes. Empty when never set.
export async function getUserRegion(userId: string): Promise<string> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? ((snap.data().region ?? "") as string) : "";
}

// Persist a region override (the users doc is owner-writable per Firestore rules).
export async function setUserRegion(userId: string, region: string): Promise<void> {
  await setDoc(doc(db, "users", userId), { region: region.toUpperCase() }, { merge: true });
}

// Best-effort country guess from the browser, for first-run region seeding.
// Intl timezone → country isn't directly available, so fall back to the navigator
// language's region subtag (e.g. "en-IN" → "IN"). Returns "" when undeterminable.
function guessRegion(): string {
  const lang = navigator.language || "";
  const m = lang.match(/[-_]([A-Za-z]{2})$/);
  return m ? m[1].toUpperCase() : "";
}

// Seed users/{uid}.region once on first sign-in if the user has none yet. Fire-and-forget;
// the backend falls back to DEFAULT_WATCH_REGION when this hasn't run.
export async function ensureUserRegion(userId: string): Promise<void> {
  try {
    const current = await getUserRegion(userId);
    if (current) return;
    const guess = guessRegion();
    if (guess) await setUserRegion(userId, guess);
  } catch {
    // non-critical — leave region unset and let the backend default apply.
  }
}
