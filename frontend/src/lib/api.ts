import { getAuthHeader } from "@/integrations/firebase/auth-middleware";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

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

export async function ingest(url: string): Promise<{ job_id: string; status: string }> {
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

// Owner edits to a note: a private annotation (user_note) and/or recategorisation
// (content_type). Writes route through the backend (Firestore forbids client writes);
// the feed's onSnapshot listener reflects the change live.
export async function updateNote(
  id: string,
  updates: { user_note?: string; content_type?: string; title?: string },
): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't update the note."), res.status);
}

// --- Categories (manage the user's taxonomy) ---

// The taxonomy joined with per-type note counts. Rename/delete re-tag the affected
// notes server-side (Firestore forbids client writes to notes/), so they live here.
export interface CategoryInfo {
  slug: string;
  count: number;
  icon?: string; // pinned icon name (see note-meta CATEGORY_ICONS); absent = auto-derived
  palette?: number; // pinned palette index; absent = auto-derived
}

export async function listCategories(): Promise<CategoryInfo[]> {
  const res = await apiFetch("/api/categories");
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't load your categories."), res.status);
  return res.json();
}

export async function createCategory(
  name: string,
  meta?: { icon?: string; palette?: number },
): Promise<CategoryInfo> {
  const res = await apiFetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...meta }),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't create the category."), res.status);
  return res.json();
}

// Rename and/or re-skin a category. Any subset of {new_name, icon, palette} may be sent;
// renaming re-tags the affected notes server-side and moves the icon/colour to the new slug.
export async function updateCategory(
  slug: string,
  patch: { new_name?: string; icon?: string; palette?: number },
): Promise<CategoryInfo> {
  const res = await apiFetch(`/api/categories/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't update the category."), res.status);
  return res.json();
}

export async function deleteCategory(
  slug: string,
  moveTo?: string,
): Promise<{ moved_to: string; count: number }> {
  const qs = moveTo ? `?move_to=${encodeURIComponent(moveTo)}` : "";
  const res = await apiFetch(`/api/categories/${encodeURIComponent(slug)}${qs}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't delete the category."), res.status);
  return res.json();
}

// --- Ask AI (chat grounded in saved notes) ---

export interface AskCitation {
  id: string;
  title: string;
  content_type: string;
  cover_image_url: string | null;
  source_domain: string;
}

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

// A consolidated artifact Ask AI built across several notes (Phase 2). `data` holds the
// same block schema GenericNote renders (sections/steps/table/checklist/facts).
export interface AskArtifact {
  title: string;
  ai_summary: string;
  content_type: string;
  data: Record<string, unknown>;
  origin?: "consolidated" | "created"; // provenance for the saved note
}

export interface AskResult {
  answer: string;
  citations: AskCitation[];
  coverage?: string | null; // "Based on 6 of 12 matching notes." — null for general-chat replies
  artifact?: AskArtifact | null; // present when the user asked to consolidate notes
}

export async function ask(
  question: string,
  history: AskTurn[],
  noteId?: string,
): Promise<AskResult> {
  // Minutes EAST of UTC, so the backend resolves "today"/"this week" against the user's
  // local day (getTimezoneOffset is minutes to ADD to local to reach UTC, hence the negation).
  const tz_offset_minutes = -new Date().getTimezoneOffset();
  const res = await apiFetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // note_id scopes the chat to a focal note ("this note first, then all") when opened
    // from a note's page; omitted means corpus-wide.
    body: JSON.stringify({ question, history, tz_offset_minutes, note_id: noteId ?? null }),
  });
  if (!res.ok) {
    throw new ApiError(
      await errorDetail(res, "Couldn't get an answer. Please try again."),
      res.status,
    );
  }
  return res.json();
}

// Persist an Ask-AI-built artifact as a real note (Phase 2 "Save as note"). Returns the
// new note id so the UI can link straight to it.
export async function saveConsolidatedNote(
  artifact: AskArtifact,
  sourceNoteIds: string[],
): Promise<{ id: string }> {
  const res = await apiFetch("/api/notes/consolidated", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: artifact.title,
      ai_summary: artifact.ai_summary,
      content_type: artifact.content_type,
      data: artifact.data,
      source_note_ids: sourceNoteIds,
      origin: artifact.origin ?? "consolidated",
    }),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't save the note."), res.status);
  return res.json();
}

// --- Shareable public notes ---

// Make a note publicly readable; returns the /p/{id} link to share.
export async function shareNote(id: string): Promise<{ is_public: boolean; url: string }> {
  const res = await apiFetch(`/api/notes/${id}/share`, { method: "POST" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't create a share link."), res.status);
  return res.json();
}

// Save a publicly-shared note into the signed-in user's own account. Returns the new
// note's id (or the original id if it's already theirs) so the UI can open it.
export async function saveSharedNote(id: string): Promise<{ id: string }> {
  const res = await apiFetch(`/api/notes/${id}/save`, { method: "POST" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't save the note."), res.status);
  return res.json();
}

// Revoke public access — the shared link stops resolving.
export async function unshareNote(id: string): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}/share`, { method: "DELETE" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't make the note private."), res.status);
}

// --- Semantic search (Firestore Vector Search, scoped to the user's notes) ---

export interface SearchResult {
  id: string;
  content_type: string;
  title: string;
  ai_summary: string;
  source_domain: string;
  cover_image_url: string | null;
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
  return res.json();
}

export async function listTokens(): Promise<ShortcutToken[]> {
  const res = await apiFetch("/api/tokens");
  if (!res.ok) throw new Error("Couldn't load tokens.");
  return res.json();
}

export async function revokeToken(id: string): Promise<void> {
  const res = await apiFetch(`/api/tokens/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Couldn't revoke token.");
}

// --- Admin dashboard ---

export interface AdminUserRow {
  uid: string;
  email: string | null;
  display_name: string | null;
  created_at: number | null; // epoch ms
  last_sign_in: number | null; // epoch ms
  notes: number;
  tokens_in: number;
  tokens_out: number;
  tokens: number;
  images: number;
  ai_calls: number;
  cost_usd: number;
  cost_inr: number;
  active_7d: boolean;
  active_30d: boolean;
}

export interface AdminStats {
  generated_at: string;
  totals: {
    users: number;
    notes: number;
    active_7d: number;
    active_30d: number;
    tokens: number;
    images: number;
    cost_usd: number;
    cost_inr: number;
    jobs: number;
    jobs_failed: number;
    notes_today: number;
    asks_today: number;
    images_today: number;
  };
  pricing_note: string;
  users: AdminUserRow[];
}

export async function adminStats(): Promise<AdminStats> {
  const res = await apiFetch("/api/admin/stats");
  if (!res.ok) {
    throw new ApiError(await errorDetail(res, "Couldn't load admin stats."), res.status);
  }
  return res.json();
}

export const API_BASE = API_URL;
