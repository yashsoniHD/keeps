import {
  getFirestore,
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
  onSnapshot,
  serverTimestamp,
  getCountFromServer,
  type Unsubscribe,
} from "@react-native-firebase/firestore";
import type { Note, Job, Collection, WatchItem, PlaceItem } from "@clipnote/shared";

// The default-app Firestore handle. RNFirebase auto-initialises the default app from the native
// google-services / GoogleService-Info config, so no explicit initializeApp is needed here (the
// web app imported a `db` singleton from its firebase client integration instead).
const db = getFirestore();

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
    // A real collection id — array-contains membership in `collection_ids` (multi-home: a note
    // can belong to more than one collection). There is no caller that needs "notes with no
    // collection" through this param (that would need a separate scalar `collection_id == null`
    // query, since Firestore can't express "array is empty" as array-contains) — grepped and
    // confirmed unused, so it isn't supported here.
    collectionId?: string;
    onError?: (e: Error) => void;
  } = {},
): Unsubscribe {
  const { max = 50, contentType, collectionId, onError } = opts;
  const types = contentType ? (Array.isArray(contentType) ? contentType : [contentType]) : [];
  const clauses = [
    where("user_id", "==", userId),
    ...(types.length === 1
      ? [where("content_type", "==", types[0])]
      : types.length > 1
        ? [where("content_type", "in", types.slice(0, 10))]
        : []),
    // Backed by the (user_id, collection_ids array-contains, created_at) composite index.
    ...(collectionId ? [where("collection_ids", "array-contains", collectionId)] : []),
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
  return snap.exists() ? ((snap.data()?.user_note ?? "") as string) : "";
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
  return snap.exists() ? ((snap.data()?.categories ?? []) as string[]).sort() : [];
}

// One doc read against users/{uid}.sources — the whole-corpus source list, so the feed's
// source filter stays stable instead of collapsing to the category-filtered window.
export async function getUserSources(userId: string): Promise<string[]> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? ((snap.data()?.sources ?? []) as string[]).sort() : [];
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
  if (slug)
    await setDoc(doc(db, "users", userId), { categories: arrayUnion(slug) }, { merge: true });
  return slug;
}

// Getting-started guide flag lives on the user doc (not local storage) so dismissing
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
  opts: { description?: string; icon?: string | null; palette?: number | null } = {},
): Promise<string> {
  const { description = "", icon = null, palette = null } = opts;
  const ref = await addDoc(collection(db, "collections"), {
    user_id: userId,
    name: name.trim(),
    description: description.trim() || null,
    icon,
    palette,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCollectionMeta(
  cid: string,
  patch: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    palette?: number | null;
  },
): Promise<void> {
  const clean: Record<string, unknown> = { updated_at: serverTimestamp() };
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.description !== undefined)
    clean.description = patch.description ? patch.description.trim() : null;
  if (patch.icon !== undefined) clean.icon = patch.icon;
  if (patch.palette !== undefined) clean.palette = patch.palette;
  await updateDoc(doc(db, "collections", cid), clean);
}

// Live notes in a smart bucket, newest first. Membership lives on each note's `collection_ids`
// array (multi-home, backend-written: embedding match at ingest + rescore + pin/exclude).
export function watchNotesInCollection(
  userId: string,
  collectionId: string,
  callback: (notes: Note[]) => void,
  opts: { max?: number; onError?: (e: Error) => void } = {},
): Unsubscribe {
  return watchNotes(userId, callback, {
    collectionId,
    max: opts.max ?? 200,
    onError: opts.onError,
  });
}

// Client-side fallback delete (no member-note sweep) — kept as a last resort for
// `deleteCollectionApi` (backend, `DELETE /api/collections/{id}`) to fall back to on failure,
// so the folder still goes away even if the sweep couldn't run.
export async function deleteCollection(cid: string): Promise<void> {
  await deleteDoc(doc(db, "collections", cid));
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
  return snap.exists() && snap.data()?.onboarding_done === true;
}

export async function setOnboardingDone(userId: string): Promise<void> {
  await setDoc(doc(db, "users", userId), { onboarding_done: true }, { merge: true });
}

// Count of hand-made notes (typed / photo / PDF / voice / video — everything that isn't a URL
// capture) for the "Your notes" folder tile. A server-side aggregate: one cheap read instead of
// streaming 200 note docs just to derive a number. Equality-only filters, so no composite index.
export async function getManualNotesCount(userId: string): Promise<number> {
  const q = query(
    collection(db, "notes"),
    where("user_id", "==", userId),
    where("input_type", "in", ["text", "image", "pdf", "voice", "video"]),
  );
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

// One-shot aggregate counts for the mini-app subcollections, for the Collections launcher
// tiles. A snapshot on mount is enough (no listener) — these are quiet counts, not a live wall.
// A per-app value of `null` means that one aggregate failed (the tile renders a quiet dash, not
// a skeleton) — distinct from the whole map being null, which the caller uses for "still loading".
export type MiniAppItemCounts = {
  watchlist: number | null;
  places: number | null;
};

const MINI_APP_SUBCOLLECTIONS: Record<keyof MiniAppItemCounts, string> = {
  watchlist: "watch_items",
  places: "place_items",
};

// Resilient like the mini-app walls (see wall.tsx): `Promise.allSettled`, not `Promise.all`, so
// one failing aggregate doesn't reject the whole fetch and freeze every tile on a skeleton. A
// rejected count comes back as `null` (its tile shows a dash) and the reason is logged once so
// failures are no longer silently masked.
export async function getMiniAppItemCounts(userId: string): Promise<MiniAppItemCounts> {
  const keys = Object.keys(MINI_APP_SUBCOLLECTIONS) as (keyof MiniAppItemCounts)[];
  const results = await Promise.allSettled(
    keys.map((key) =>
      getCountFromServer(collection(db, "users", userId, MINI_APP_SUBCOLLECTIONS[key])),
    ),
  );
  const counts = {} as MiniAppItemCounts;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      counts[keys[i]] = r.value.data().count;
    } else {
      counts[keys[i]] = null;
      console.error(`getMiniAppItemCounts: "${keys[i]}" count failed`, r.reason);
    }
  });
  return counts;
}

// Note count for a single user-created collection — user_id equality + collection_ids
// array-contains (no orderBy) so it needs no composite index beyond the existing
// array-contains one. Best-effort: callers should treat a rejected promise as "unknown"
// rather than block the tile on it.
export async function getCollectionNoteCount(
  userId: string,
  collectionId: string,
): Promise<number> {
  const q = query(
    collection(db, "notes"),
    where("user_id", "==", userId),
    where("collection_ids", "array-contains", collectionId),
  );
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

// The user's region (ISO-3166-1 alpha-2) — feeds streaming availability and reservation
// links on enriched notes. Empty when never set.
export async function getUserRegion(userId: string): Promise<string> {
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? ((snap.data()?.region ?? "") as string) : "";
}

// Persist a region override (the users doc is owner-writable per Firestore rules).
export async function setUserRegion(userId: string, region: string): Promise<void> {
  await setDoc(doc(db, "users", userId), { region: region.toUpperCase() }, { merge: true });
}

// Best-effort country guess from the device, for first-run region seeding. The web version read
// `navigator.language`'s region subtag; RN has no navigator, so we read the device locale via
// Intl (e.g. "en-IN" → "IN"). Returns "" when undeterminable.
function guessRegion(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "";
    const m = locale.match(/[-_]([A-Za-z]{2})\b/);
    return m ? m[1].toUpperCase() : "";
  } catch {
    return "";
  }
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

// ─── Mini-app item watchers (restored) ────────────────────────────────────
// One-shot job read (owner-only per rules) — used to recover the captured URL for older
// mini-app items whose source_note_ids hold a job id (item-only captures create no note).
export async function getJob(jobId: string): Promise<Job | null> {
  const snap = await getDoc(doc(db, "jobs", jobId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Job;
}

// Live listener over the user's watch_items subcollection (read-only — writes go through
// the backend). Ordered newest-first; the view splits To-Watch / Watched client-side.
export function watchWatchItems(
  userId: string,
  callback: (items: WatchItem[]) => void,
  opts: { max?: number; onError?: (e: Error) => void } = {},
): Unsubscribe {
  const { max = 200, onError } = opts;
  const q = query(
    collection(db, "users", userId, "watch_items"),
    orderBy("created_at", "desc"),
    limit(max),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WatchItem)),
    (err) => onError?.(err),
  );
}

// Live listener over a single watch item (for the detail page) so status/rating changes
// reflect instantly. Calls back with null if the item is deleted or doesn't exist.
export function watchWatchItem(
  userId: string,
  itemId: string,
  callback: (item: WatchItem | null) => void,
  opts: { onError?: (e: Error) => void } = {},
): Unsubscribe {
  return onSnapshot(
    doc(db, "users", userId, "watch_items", itemId),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as WatchItem) : null),
    (err) => opts.onError?.(err),
  );
}

// Live listener over the user's place_items subcollection (read-only — writes go through the
// backend). Ordered newest-first; the view splits Saved / To-visit / Visited client-side.
export function watchPlaceItems(
  userId: string,
  callback: (items: PlaceItem[]) => void,
  opts: { max?: number; onError?: (e: Error) => void } = {},
): Unsubscribe {
  const { max = 200, onError } = opts;
  const q = query(
    collection(db, "users", userId, "place_items"),
    orderBy("created_at", "desc"),
    limit(max),
  );
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PlaceItem)),
    (err) => onError?.(err),
  );
}

// Live listener over a single place item (for the detail page) so status/rating/notes changes
// reflect instantly. Calls back with null if the item is deleted or doesn't exist.
export function watchPlaceItem(
  userId: string,
  itemId: string,
  callback: (item: PlaceItem | null) => void,
  opts: { onError?: (e: Error) => void } = {},
): Unsubscribe {
  return onSnapshot(
    doc(db, "users", userId, "place_items", itemId),
    (snap) => callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as PlaceItem) : null),
    (err) => opts.onError?.(err),
  );
}
