import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  documentId,
  arrayUnion,
  arrayRemove,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/integrations/firebase/client";
import type { Note, Job, Collection } from "@/lib/types";

// Record signup attribution on the user's own doc (rules allow owner writes). Merge so it
// never clobbers backend-written fields; called once, on first sign-in.
export async function recordSignup(uid: string, ref: string | null): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    { signup_ref: ref || "direct", signup_at: serverTimestamp() },
    { merge: true },
  );
}

// Weekly-digest opt-in lives on the user's own doc. Absent field = opted in (the default).
export async function getDigestOptIn(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data().digest_opt_in === true : false;
}

export async function setDigestOptIn(uid: string, on: boolean): Promise<void> {
  await setDoc(doc(db, "users", uid), { digest_opt_in: on }, { merge: true });
}

// Real-time feed: notes appear/update without a manual refetch. Returns an unsubscribe fn.
// contentType filters server-side via the (user_id, content_type, created_at) composite
// index, so a filtered view reaches past the feed window instead of slicing loaded docs.
export function watchNotes(
  userId: string,
  callback: (notes: Note[]) => void,
  opts: { max?: number; contentType?: string; onError?: (e: Error) => void } = {},
): Unsubscribe {
  const { max = 50, contentType, onError } = opts;
  const clauses = [
    where("user_id", "==", userId),
    ...(contentType ? [where("content_type", "==", contentType)] : []),
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

// The owner's private annotation lives in a separate owner-only doc (so it never rides
// along on a publicly shared note). Returns "" when there's no annotation yet.
export async function getAnnotation(noteId: string): Promise<string> {
  const snap = await getDoc(doc(db, "annotations", noteId));
  return snap.exists() ? ((snap.data().user_note ?? "") as string) : "";
}

export function watchJob(jobId: string, callback: (job: Partial<Job>) => void): Unsubscribe {
  return onSnapshot(doc(db, "jobs", jobId), (snap) => {
    if (snap.exists()) callback(snap.data() as Partial<Job>);
  });
}

// How long a failed job stays visible in the feed (it can also be dismissed).
const FAILED_JOB_TTL_MS = 6 * 60 * 60 * 1000;

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
    const cutoff = Date.now() - FAILED_JOB_TTL_MS;
    const jobs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Job)
      .filter(
        (j) =>
          j.status === "pending" ||
          j.status === "processing" ||
          j.status === "deferred" || // parked by the global cap — shown as "Queued"
          (j.status === "failed" && ((j.updated_at ?? j.created_at)?.toMillis() ?? 0) > cutoff),
      );
    callback(jobs);
  });
}

// One doc read against users/{uid}.categories — never scan the notes collection.
export async function getUserCategories(userId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? ((snap.data().categories ?? []) as string[]).sort() : [];
}

// One doc read against users/{uid}.sources — the whole-corpus source list, so the feed's
// source filter stays stable instead of collapsing to the category-filtered window.
export async function getUserSources(userId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? ((snap.data().sources ?? []) as string[]).sort() : [];
}

// kebab-case a label into a category slug, matching the backend's normalize_slug.
export function slugifyCategory(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Add a category to users/{uid}.categories (idempotent via arrayUnion). The users doc is
// owner-writable per Firestore rules, so this needs no backend round-trip. Returns the slug.
export async function addUserCategory(userId: string, label: string): Promise<string> {
  const slug = slugifyCategory(label);
  if (slug) await setDoc(doc(db, "users", userId), { categories: arrayUnion(slug) }, { merge: true });
  return slug;
}

// Getting-started guide flag lives on the user doc (not localStorage) so dismissing
// it once sticks across devices and reinstalls.
// --- Favorites & collections (the Library's pull-side discoverability) ---

// Starred notes, newest first. Backed by the (user_id, is_favorite, created_at) index.
// Unlike the feed, this isn't windowed — a favorite always surfaces here however old it is.
export function watchFavorites(
  userId: string,
  callback: (notes: Note[]) => void,
  opts: { onError?: (e: Error) => void } = {},
): Unsubscribe {
  const q = query(
    collection(db, "notes"),
    where("user_id", "==", userId),
    where("is_favorite", "==", true),
    orderBy("created_at", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Note)),
    (err) => opts.onError?.(err),
  );
}

// User-created folders, most-recently-touched first. Owner-writable client-side (see
// firestore.rules) — collections hold only the user's own organisation, never note content.
export function watchCollections(
  userId: string,
  callback: (cols: Collection[]) => void,
  opts: { onError?: (e: Error) => void } = {},
): Unsubscribe {
  const q = query(
    collection(db, "collections"),
    where("user_id", "==", userId),
    orderBy("updated_at", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Collection)),
    (err) => opts.onError?.(err),
  );
}

export async function getCollection(cid: string): Promise<Collection | null> {
  const snap = await getDoc(doc(db, "collections", cid));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Collection) : null;
}

export async function createCollection(
  userId: string,
  name: string,
  icon: string | null = null,
  palette: number | null = null,
): Promise<string> {
  const ref = await addDoc(collection(db, "collections"), {
    user_id: userId,
    name: name.trim(),
    icon,
    palette,
    note_ids: [],
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCollectionMeta(
  cid: string,
  patch: { name?: string; icon?: string | null; palette?: number | null },
): Promise<void> {
  const clean: Record<string, unknown> = { updated_at: serverTimestamp() };
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.icon !== undefined) clean.icon = patch.icon;
  if (patch.palette !== undefined) clean.palette = patch.palette;
  await updateDoc(doc(db, "collections", cid), clean);
}

export async function deleteCollection(cid: string): Promise<void> {
  await deleteDoc(doc(db, "collections", cid));
}

export async function addNoteToCollection(cid: string, noteId: string): Promise<void> {
  await updateDoc(doc(db, "collections", cid), {
    note_ids: arrayUnion(noteId),
    updated_at: serverTimestamp(),
  });
}

export async function removeNoteFromCollection(cid: string, noteId: string): Promise<void> {
  await updateDoc(doc(db, "collections", cid), {
    note_ids: arrayRemove(noteId),
    updated_at: serverTimestamp(),
  });
}

// Fetch notes by id for a collection detail view. Firestore caps `in` queries at 10 ids, so
// fan out in chunks. Returned in the caller's id order (Firestore won't preserve it). Missing
// ids (a note since deleted) are simply skipped.
export async function getNotesByIds(ids: string[]): Promise<Note[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
  const byId = new Map<string, Note>();
  await Promise.all(
    chunks.map(async (chunk) => {
      const q = query(collection(db, "notes"), where(documentId(), "in", chunk));
      const snap = await getDocs(q);
      snap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() } as Note));
    }),
  );
  return ids.map((id) => byId.get(id)).filter((n): n is Note => !!n);
}

export async function getOnboardingDone(userId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() && snap.data().onboarding_done === true;
}

export async function setOnboardingDone(userId: string): Promise<void> {
  await setDoc(doc(db, "users", userId), { onboarding_done: true }, { merge: true });
}
