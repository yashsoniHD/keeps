import { getAuthHeader } from "@/integrations/firebase/auth-middleware";
import { getOrFetch, invalidateCache } from "@/lib/swr-cache";

// The fallback must be environment-aware: a production build must NEVER point at localhost
// (Vite loads .env*.local in all modes, so a stray VITE_API_URL could otherwise ship). When
// the var is unset, dev talks to the local backend and prod talks to the live Vercel API.
const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV
    ? "http://localhost:8080"
    : "https://keeps-api-yashsoni102-progs-projects.vercel.app"); // must match the Vercel project's production alias (Phase F sets the real one)

// All API calls go through this: a 401 usually means the cached Firebase token
// expired while the tab was backgrounded — retry exactly once with a forced refresh.
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async (forceRefresh: boolean) => {
    const headers = await getAuthHeader(forceRefresh);
    return fetch(`${API_URL}${path}`, { ...init, headers: { ...init.headers, ...headers } });
  };
  let res = await attempt(false);
  if (res.status === 401) res = await attempt(true);
  return res;
}

async function errorDetail(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => ({}) as { detail?: string });
  return typeof err.detail === "string" ? err.detail : fallback;
}

// Carries the HTTP status so callers can tell "the server rejected this" (4xx — don't
// retry) from "the server/network is down" (5xx / fetch failure — queue and retry).
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// An exact-duplicate save returns `{status: "completed", note_id}` (no new job) — callers
// should go to the existing note instead of waiting on a processing card.
export interface IngestResult {
  job_id?: string;
  status: string;
  note_id?: string;
}

export async function ingest(url: string): Promise<IngestResult> {
  const res = await apiFetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new ApiError(
      await errorDetail(res, "Couldn't start the capture. Please try again."),
      res.status,
    );
  }
  return res.json();
}

// Save a typed thought / pasted passage as a note (no URL). Same job pipeline as ingest().
// processAI=false saves the text verbatim (no Gemini structuring) — the user titles/tags it.
export async function ingestText(
  text: string,
  title?: string,
  processAI = true,
): Promise<{ job_id: string; status: string }> {
  const res = await apiFetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_type: "text",
      text,
      title: title || undefined,
      process_ai: processAI,
    }),
  });
  if (!res.ok) {
    throw new ApiError(
      await errorDetail(res, "Couldn't save the note. Please try again."),
      res.status,
    );
  }
  return res.json();
}

// Re-run a note's source through the extraction pipeline, overwriting the note in place
// (heals a sparse or stale capture). Returns a job_id the caller watches via watchJob; the
// note refreshes once the job completes. Counts against the per-user daily ingest cap.
export async function reextractNote(noteId: string): Promise<{ job_id: string }> {
  const res = await apiFetch(`/api/notes/${noteId}/reextract`, { method: "POST" });
  if (!res.ok)
    throw new ApiError(
      await errorDetail(res, "Couldn't re-extract this note. Please try again."),
      res.status,
    );
  return res.json();
}

// Owner edits to a note: title, summary, data and/or recategorisation (content_type). Writes route through the backend (Firestore forbids client writes);
// the feed's onSnapshot listener reflects the change live.
export async function updateNote(
  id: string,
  updates: {
    content_type?: string;
    title?: string;
    ai_summary?: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't update the note."), res.status);
  // An edit/move changes the feed — drop the SWR cache so the next visit can't flash
  // the pre-mutation note before the live listener catches up. (In-feed mutations rewrite the
  // cache anyway via the listener; this covers edits made from the note detail page.)
  invalidateCache("feed:");
}

// Delete a note. Routes through the backend (not a direct Firestore delete) so the server
// can retire the note's category if it was the last one of its type. The feed's onSnapshot
// listener still removes the card live once the doc is gone.
export async function deleteNote(id: string): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't delete the note."), res.status);
  // Drop the feed cache so a deleted note can't flash back on the next visit (the live listener
  // then repopulates from truth).
  invalidateCache("feed:");
}

// --- Search (keyword + vector over the user's notes; 3-char minimum server-side) ---

export interface SearchResult {
  id: string;
  content_type: string;
  title: string;
  ai_summary: string;
  source_domain: string;
  cover_image_url: string | null;
  cover_thumb?: string | null;
  ref_id?: string | null; // the underlying note id (same as id)
}

export async function searchNotes(q: string): Promise<SearchResult[]> {
  const res = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new ApiError(await errorDetail(res, "Search failed."), res.status);
  const data = (await res.json()) as { results?: SearchResult[] };
  return data.results ?? [];
}

// --- Personal Access Tokens (iOS shortcut) ---

export interface ShortcutToken {
  id: string;
  label: string;
  created_at?: string;
  last_used_at?: string | null;
}

export async function createToken(label: string): Promise<{ token: string; id: string }> {
  const res = await apiFetch("/api/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!res.ok) throw new Error(await errorDetail(res, "Couldn't create token."));
  invalidateCache("tokens:"); // the cached PAT list is now stale
  return res.json();
}

export async function listTokens(): Promise<ShortcutToken[]> {
  const res = await apiFetch("/api/tokens");
  if (!res.ok) throw new Error("Couldn't load tokens.");
  return res.json();
}

// Cached PAT list (no live listener): dedupes the concurrent GettingStarted + Settings mounts
// onto one GET and serves it from cache for a few minutes. Mutators above invalidate "tokens:".
export function listTokensCached(uid: string): Promise<ShortcutToken[]> {
  return getOrFetch(`tokens:${uid}`, listTokens);
}

export async function revokeToken(id: string): Promise<void> {
  const res = await apiFetch(`/api/tokens/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Couldn't revoke token.");
  invalidateCache("tokens:"); // the cached PAT list is now stale
}
