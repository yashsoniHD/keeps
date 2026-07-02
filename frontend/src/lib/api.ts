import { getAuthHeader } from "@/integrations/firebase/auth-middleware";
import type {
  TmdbSearchResult,
  WatchItemDetails,
  PlaceSearchResult,
  PlaceItemDetails,
} from "@/lib/types";

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

// Save a screenshot/image or PDF. Multipart so the bytes go straight to GCS; the backend
// returns a job_id the same way the URL path does. Do NOT set Content-Type — the browser
// adds the multipart boundary itself.
export async function ingestMedia(
  file: File,
  inputType: "image" | "pdf" | "voice" | "video",
  title?: string,
): Promise<{ job_id: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("input_type", inputType);
  form.append("source", "upload");
  if (title) form.append("title", title);
  const res = await apiFetch("/api/ingest/upload", { method: "POST", body: form });
  if (!res.ok) {
    throw new ApiError(
      await errorDetail(res, "Couldn't add that file. Please try again."),
      res.status,
    );
  }
  return res.json();
}

// Save a voice memo: the recorder hands us an audio Blob, which we wrap as a File and push
// through the same multipart upload path as images/PDFs. The worker transcribes it with
// Gemini and structures the result into a note.
export async function ingestVoice(
  blob: Blob,
  title?: string,
): Promise<{ job_id: string; status: string }> {
  const ext = blob.type.includes("mp4")
    ? "m4a"
    : blob.type.includes("ogg")
      ? "ogg"
      : blob.type.includes("wav")
        ? "wav"
        : "webm";
  const file = new File([blob], `voice.${ext}`, { type: blob.type || "audio/webm" });
  return ingestMedia(file, "voice", title);
}

// Owner edits to a note: a private annotation (user_note) and/or recategorisation
// (content_type). Writes route through the backend (Firestore forbids client writes);
// the feed's onSnapshot listener reflects the change live.
export async function updateNote(
  id: string,
  updates: {
    user_note?: string;
    content_type?: string;
    title?: string;
    ai_summary?: string;
    data?: Record<string, unknown>;
    is_favorite?: boolean;
    pinned?: boolean;
    collection_id?: string | null; // move to a bucket (id) or the catch-all (null)
  },
): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't update the note."), res.status);
}

// Move a note into a smart bucket (or back to the catch-all with null). Membership is
// backend-written (notes are backend-write-only), so this is a thin PATCH wrapper.
export async function moveNoteToCollection(
  noteId: string,
  collectionId: string | null,
): Promise<void> {
  await updateNote(noteId, { collection_id: collectionId });
}

// After creating a collection, sweep the user's existing unassigned notes into it (embedding
// match, backend). Returns how many were filed. Best-effort — a failure just leaves them unfiled.
export async function backfillCollection(collectionId: string): Promise<{ assigned: number }> {
  const res = await apiFetch(`/api/collections/${collectionId}/backfill`, { method: "POST" });
  if (!res.ok)
    throw new ApiError(
      await errorDetail(res, "Couldn't sort notes into the collection."),
      res.status,
    );
  return res.json();
}

// Delete a note. Routes through the backend (not a direct Firestore delete) so the server
// can retire the note's category if it was the last one of its type. The feed's onSnapshot
// listener still removes the card live once the doc is gone.
export async function deleteNote(id: string): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't delete the note."), res.status);
}

// --- Watchlist mini-app ---

// Toggle watched / set a 1–5 rating on a watch item. Writes route through the backend
// (Firestore forbids client writes to watch_items); the view's onSnapshot reflects it live.
export async function updateWatchItem(
  itemId: string,
  updates: {
    watch_status?: "saved" | "to_watch" | "watching" | "watched";
    rating?: number;
    favorite?: boolean;
  },
): Promise<void> {
  const res = await apiFetch(`/api/watch-items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't update the watch item."), res.status);
}

// Search TMDB for the manual-add picker.
export async function searchWatchTitles(q: string): Promise<TmdbSearchResult[]> {
  const res = await apiFetch(`/api/watch-items/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new ApiError(await errorDetail(res, "Search failed."), res.status);
  return (await res.json()).results as TmdbSearchResult[];
}

// Manually add a TMDB title to the watchlist. Returns the new item id.
export async function addWatchItem(item: {
  tmdb_id: number;
  media_type: "movie" | "tv";
}): Promise<string> {
  const res = await apiFetch("/api/watch-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't add the title."), res.status);
  return (await res.json()).id as string;
}

// Fetch rich TMDB details (cast/runtime/rating) for the detail page. `{}` for raw titles.
export async function getWatchItemDetails(itemId: string): Promise<WatchItemDetails> {
  const res = await apiFetch(`/api/watch-items/${itemId}/details`);
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't load details."), res.status);
  return res.json();
}

export async function deleteWatchItem(itemId: string): Promise<void> {
  const res = await apiFetch(`/api/watch-items/${itemId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't remove the title."), res.status);
}

// Import movies & shows from the user's existing entertainment notes into the watchlist.
// Safe to re-run (idempotent); returns how many notes were scanned and titles found.
export async function backfillWatchItems(): Promise<{
  notes_processed: number;
  titles_found: number;
}> {
  const res = await apiFetch("/api/watch-items/backfill", { method: "POST" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't import from your notes."), res.status);
  return res.json();
}

// --- Wishlist mini-app ---

// Promote to-buy / mark bought / set a target price on a wish item. Writes route through the
// backend (Firestore forbids client writes to wish_items); the view's onSnapshot reflects it
// live. Pass target_price: null to clear a target; omit it to leave it untouched.
export async function updateWishItem(
  itemId: string,
  updates: {
    wish_status?: "saved" | "to_buy" | "purchased";
    target_price?: number | null;
    favorite?: boolean;
  },
): Promise<void> {
  const res = await apiFetch(`/api/wish-items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't update the wish item."), res.status);
}

export async function deleteWishItem(itemId: string): Promise<void> {
  const res = await apiFetch(`/api/wish-items/${itemId}`, { method: "DELETE" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't remove the product."), res.status);
}

// Import products from the user's existing product notes into the wishlist. Safe to re-run
// (idempotent); returns how many product notes were scanned.
export async function backfillWishItems(): Promise<{
  notes_processed: number;
  products_found: number;
}> {
  const res = await apiFetch("/api/wish-items/backfill", { method: "POST" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't import from your notes."), res.status);
  return res.json();
}

// --- Places mini-app ---

// Promote to-visit / mark visited / set a 1–5 personal rating / edit your notes on a place item.
// Writes route through the backend (Firestore forbids client writes to place_items); the view's
// onSnapshot reflects it live. Pass user_notes: null to clear a note; omit it to leave untouched.
export async function updatePlaceItem(
  itemId: string,
  updates: {
    place_status?: "saved" | "to_visit" | "visited";
    user_rating?: number;
    user_notes?: string | null;
    favorite?: boolean;
    log_visit?: boolean; // record another visit (bumps visit_count, advances visited_at)
  },
): Promise<void> {
  const res = await apiFetch(`/api/place-items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't update the place."), res.status);
}

// Search Google Places for the manual-add picker.
export async function searchPlaces(q: string): Promise<PlaceSearchResult[]> {
  const res = await apiFetch(`/api/place-items/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new ApiError(await errorDetail(res, "Search failed."), res.status);
  return (await res.json()).results as PlaceSearchResult[];
}

// Manually add a Google Place to the places list. Returns the new item id.
export async function addPlaceItem(item: { place_id: string }): Promise<string> {
  const res = await apiFetch("/api/place-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't add the place."), res.status);
  return (await res.json()).id as string;
}

// Fetch rich Google Place details (hours/photo/website) for the detail page. `{}` for raw venues.
export async function getPlaceItemDetails(itemId: string): Promise<PlaceItemDetails> {
  const res = await apiFetch(`/api/place-items/${itemId}/details`);
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't load details."), res.status);
  return res.json();
}

export async function deletePlaceItem(itemId: string): Promise<void> {
  const res = await apiFetch(`/api/place-items/${itemId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't remove the place."), res.status);
}

// Import places from the user's existing place notes into the places list. Safe to re-run
// (idempotent); returns how many notes were scanned and venues found.
export async function backfillPlaceItems(): Promise<{
  notes_processed: number;
  venues_found: number;
}> {
  const res = await apiFetch("/api/place-items/backfill", { method: "POST" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't import from your notes."), res.status);
  return res.json();
}

// --- Recipes mini-app ---

// Toggle the favorite star on a recipe. Writes through the backend (Firestore forbids client
// writes to recipe_items); the view's onSnapshot reflects it live. Recipes have no status
// workflow, so favorite is the only mutable field.
export async function updateRecipeItem(
  itemId: string,
  updates: { favorite?: boolean },
): Promise<void> {
  const res = await apiFetch(`/api/recipe-items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't update the recipe."), res.status);
}

export async function deleteRecipeItem(itemId: string): Promise<void> {
  const res = await apiFetch(`/api/recipe-items/${itemId}`, { method: "DELETE" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't remove the recipe."), res.status);
}

// Import recipes from the user's existing recipe notes into the cookbook. Safe to re-run
// (idempotent); returns how many notes were scanned and recipes found.
export async function backfillRecipeItems(): Promise<{
  notes_processed: number;
  recipes_found: number;
}> {
  const res = await apiFetch("/api/recipe-items/backfill", { method: "POST" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't import from your notes."), res.status);
  return res.json();
}

// Toggle the favorite star on a trip. Writes through the backend (Firestore forbids client writes
// to trip_items); the view's onSnapshot reflects it live. Trips have no status workflow, so favorite
// is the only mutable field.
export async function updateTripItem(
  itemId: string,
  updates: { favorite?: boolean },
): Promise<void> {
  const res = await apiFetch(`/api/trip-items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't update the trip."), res.status);
}

export async function deleteTripItem(itemId: string): Promise<void> {
  const res = await apiFetch(`/api/trip-items/${itemId}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't remove the trip."), res.status);
}

// Import trips from the user's existing itinerary notes into the wall. Safe to re-run
// (idempotent); returns how many notes were scanned and trips found.
export async function backfillTripItems(): Promise<{
  notes_processed: number;
  trips_found: number;
}> {
  const res = await apiFetch("/api/trip-items/backfill", { method: "POST" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't import from your notes."), res.status);
  return res.json();
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
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't load your categories."), res.status);
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
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't create the category."), res.status);
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
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't update the category."), res.status);
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
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't delete the category."), res.status);
  return res.json();
}

// --- Ask AI (chat grounded in saved notes) ---

export interface AskCitation {
  id: string;
  title: string;
  content_type: string;
  cover_image_url: string | null;
  source_domain: string;
  // Mini-app grounding: when set, the citation is a saved item → route to /<app>/$ref_id
  // instead of /notes/$id. Both null for plain-note citations.
  app?: string | null;
  ref_id?: string | null;
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

// A rendered chat message held in the UI's in-memory session (see ask-context.tsx).
// Richer than AskTurn (which is just the wire history) — carries citations, an artifact,
// and deep-task tracking fields so the conversation survives the chat panel closing.
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  citations?: AskCitation[];
  coverage?: string | null;
  artifact?: AskArtifact | null;
  saved_note_id?: string | null; // present when Clip AI saved a link on the user's behalf
  pending?: boolean;
  jobId?: string;
  resultNoteId?: string | null;
  failed?: boolean;
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

// Streaming agent (SSE). Events arrive as `data: {json}\n\n` frames. Callbacks fire as the
// agent works: text deltas, tool/subagent status, then final citations/artifact/coverage.
export interface AskStreamHandlers {
  onConversation?: (id: string) => void;
  onDelta?: (text: string) => void;
  onStatus?: (status: string, kind: "tool" | "agent") => void;
  onCitations?: (citations: AskCitation[]) => void;
  onArtifact?: (artifact: AskArtifact) => void;
  onCoverage?: (coverage: string) => void;
  onSavedNote?: (note_id: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

export async function askStream(
  question: string,
  history: AskTurn[],
  noteId: string | undefined,
  selectedNoteIds: string[],
  conversationId: string | null,
  handlers: AskStreamHandlers,
): Promise<void> {
  const tz_offset_minutes = -new Date().getTimezoneOffset();
  const res = await apiFetch("/api/ask/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      history,
      tz_offset_minutes,
      note_id: noteId ?? null,
      selected_note_ids: selectedNoteIds,
      conversation_id: conversationId,
    }),
  });
  if (!res.ok || !res.body) {
    throw new ApiError(
      await errorDetail(res, "Couldn't get an answer. Please try again."),
      res.status || 500,
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue; // ignore a malformed frame rather than abort the stream
      }
      switch (ev.type) {
        case "conversation":
          handlers.onConversation?.(String(ev.id ?? ""));
          break;
        case "delta":
          handlers.onDelta?.(String(ev.text ?? ""));
          break;
        case "tool":
        case "agent":
          handlers.onStatus?.(String(ev.status ?? ""), ev.type as "tool" | "agent");
          break;
        case "citations":
          handlers.onCitations?.((ev.citations as AskCitation[]) ?? []);
          break;
        case "artifact":
          handlers.onArtifact?.(ev.artifact as AskArtifact);
          break;
        case "coverage":
          handlers.onCoverage?.(String(ev.text ?? ""));
          break;
        case "saved_note":
          handlers.onSavedNote?.(String(ev.note_id ?? ""));
          break;
        case "error":
          handlers.onError?.(String(ev.message ?? "Something went wrong."));
          break;
        case "done":
          handlers.onDone?.();
          break;
      }
    }
  }
}

// "Add to this note": additively merge an AI-built artifact's blocks into an existing note.
export async function augmentNote(
  noteId: string,
  artifact: AskArtifact,
  sourceNoteIds: string[] = [],
): Promise<{ id: string }> {
  const res = await apiFetch(`/api/notes/${noteId}/augment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: artifact.data, source_note_ids: sourceNoteIds }),
  });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't update the note."), res.status);
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

// --- Chat history (persistent conversations) ---

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at?: { seconds: number } | string | null;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  citations?: AskCitation[];
  artifact?: AskArtifact | null;
  saved_note_id?: string | null;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const res = await apiFetch("/api/conversations");
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't load your chats."), res.status);
  return res.json();
}

export async function getConversation(
  cid: string,
): Promise<{ id: string; title: string; messages: ConversationMessage[] }> {
  const res = await apiFetch(`/api/conversations/${cid}`);
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't open that chat."), res.status);
  return res.json();
}

export async function deleteConversation(cid: string): Promise<void> {
  const res = await apiFetch(`/api/conversations/${cid}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await errorDetail(res, "Couldn't delete that chat."), res.status);
}

// Kick off a heavy, long-running agent task (e.g. "compile a PRD from all my startup notes").
// Returns a job_id immediately; watch the job (firestore watchJob) and open the note when it
// completes — the worker runs the agent headlessly and writes the result note.
export async function askDeep(
  question: string,
  noteId?: string,
  selectedNoteIds: string[] = [],
): Promise<{ job_id: string; status: string }> {
  const tz_offset_minutes = -new Date().getTimezoneOffset();
  const res = await apiFetch("/api/ask/deep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      history: [],
      tz_offset_minutes,
      note_id: noteId ?? null,
      selected_note_ids: selectedNoteIds,
    }),
  });
  if (!res.ok)
    throw new ApiError(
      await errorDetail(res, "Couldn't start the task. Please try again."),
      res.status,
    );
  return res.json();
}

// --- Shareable public notes ---

// Make a note publicly readable; returns the /p/{id} link to share.
export async function shareNote(id: string): Promise<{ is_public: boolean; url: string }> {
  const res = await apiFetch(`/api/notes/${id}/share`, { method: "POST" });
  if (!res.ok)
    throw new ApiError(await errorDetail(res, "Couldn't create a share link."), res.status);
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
  // When set, the hit is a mini-app item → route to /<app>/$ref_id, not /notes/$id.
  app?: string | null;
  ref_id?: string | null;
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

export interface DailyTrend {
  date: string; // "YYYYMMDD"
  notes: number;
  asks: number;
  images: number;
  cost_usd: number;
}

export interface AdminStats {
  generated_at: string;
  totals: {
    users: number;
    notes: number;
    active_7d: number;
    active_30d: number;
    activated: number;
    activation_rate: number;
    new_users_7d: number;
    new_users_30d: number;
    retained_7d: number;
    tokens: number;
    images: number;
    cost_usd: number;
    cost_inr: number;
    cost_per_note_usd: number;
    cost_per_active_user_usd: number;
    jobs: number;
    jobs_failed: number;
    notes_today: number;
    asks_today: number;
    images_today: number;
  };
  signups_by_source: Record<string, number>;
  pricing_note: string;
  daily_trend: DailyTrend[];
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
