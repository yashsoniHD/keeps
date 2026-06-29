import type { Timestamp } from "firebase/firestore";

export interface Note {
  id: string;
  user_id: string;
  content_type: string; // editable category — drives icon/colour/filter, NOT the render template
  template?: string; // immutable structural schema the `data` map was built for (render selector)
  title: string;
  ai_summary: string;
  user_note?: string; // owner's private annotation — never shown on public /p/{id}
  source_url: string;
  source_domain: string;
  source: "web" | "shortcut" | "pwa" | "upload" | "ai";
  input_type?: "url" | "text" | "image" | "pdf" | "voice" | "video"; // how it was captured (default url)
  cover_image_url: string | null;
  data: Record<string, unknown>;
  acquisition?: string;
  is_fallback?: boolean; // salvage "bookmark" note — content couldn't be processed
  is_public?: boolean; // owner shared it — readable via /p/{id} without login
  is_favorite?: boolean; // starred for quick access in the Library
  pinned_at?: Timestamp | null; // set → floats to the top of the feed; doubles as the sort key

  created_at: Timestamp;
  updated_at: Timestamp;
}

// A streaming provider ("where to watch") for a watch item, flattened by the backend so the
// frontend needs no TMDB knowledge. `type` orders them: flatrate (subscription) first.
export interface WatchProvider {
  name: string;
  logo_url: string | null;
  type: "flatrate" | "rent" | "buy";
}

// One tracked movie/show in the Watchlist mini-app. Lives at users/{uid}/watch_items/{id},
// auto-populated by the worker from entertainment notes (one note → N items) and TMDB-enriched.
// Read-only on the client; watched/rating changes go through the backend.
export interface WatchItem {
  id: string;
  user_id: string;
  source_note_ids: string[]; // the note(s) this title was recommended in
  title: string;
  year?: string | null;
  media_type: "movie" | "tv" | "unknown";
  why?: string | null; // one-line "why it's recommended" from the source
  tmdb_id?: number;
  poster_url?: string | null;
  backdrop_url?: string | null;
  overview?: string | null;
  genres?: string[];
  providers?: WatchProvider[];
  providers_region?: string;
  watch_status: "to_watch" | "watched";
  watched_at?: Timestamp | null;
  rating?: number | null; // 1–5, set on watched items
  created_at: Timestamp;
  updated_at: Timestamp;
}

// A user-created folder. Owner-writable directly from the client (holds only the user's own
// organisation — never note content), so membership lives here as a note_ids[] list.
export interface Collection {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  palette: number | null;
  note_ids: string[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface Job {
  id: string;
  user_id: string;
  url: string;
  status: "pending" | "processing" | "completed" | "failed" | "deferred";
  note_id: string | null;
  error: string | null;
  attempt_count: number;
  created_at: Timestamp;
  updated_at?: Timestamp;
}
