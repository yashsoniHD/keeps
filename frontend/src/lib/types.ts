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
  collection_id?: string | null; // smart-bucket membership (backend-written by the AI classifier);
  // null → lives in the Notes catch-all. Single-home: a note belongs to at most one collection.

  created_at: Timestamp;
  updated_at: Timestamp;
}

// A streaming provider ("where to watch") on an entertainment note's `data.titles[]` entry,
// flattened by backend TMDB enrichment so the frontend needs no TMDB knowledge. `type` orders
// them: flatrate (subscription) first.
export interface WatchProvider {
  name: string;
  logo_url: string | null;
  type: "flatrate" | "rent" | "buy";
}

// One stop on an itinerary note's day. `lat`/`lng` are filled in by backend enrichment
// (Google Places geocode of the place name) so the note map can plot it; missing when the
// stop didn't resolve.
export interface TripStop {
  time?: string | null;
  place: string;
  note?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface TripDay {
  day: number;
  title?: string | null;
  stops?: TripStop[];
}

// One action on an enriched venue (region-aware): Directions / Reserve / Order / Website /
// Instagram / Call. Built by the backend so the frontend needs no platform knowledge.
export interface PlaceAction {
  label: string;
  url: string;
  kind: "directions" | "reserve" | "order" | "website" | "instagram" | "call";
}

// A user-created smart bucket. Owner-writable directly from the client for its presentation
// (name/icon/palette/description); membership is no longer stored here — notes carry a
// `collection_id` written by the backend AI classifier, so the collection view is a live query.
// `note_ids` is retained (optional) only for reading legacy docs during migration.
export interface Collection {
  id: string;
  user_id: string;
  name: string;
  description?: string | null; // steers the AI classifier + creation-time backfill matching
  icon: string | null;
  palette: number | null;
  note_ids?: string[]; // legacy membership (pre-collection_id); migrated onto notes, then unused
  created_at: Timestamp;
  updated_at: Timestamp;
}

// Where a completed capture landed, written by the worker. Every capture is a note now;
// `kind` is kept for reading legacy jobs whose destination was a mini-app.
export interface JobDestination {
  kind: "note" | "app";
  note_id?: string; // set when kind === "note"
}

export interface Job {
  id: string;
  user_id: string;
  url: string;
  status: "pending" | "processing" | "completed" | "failed" | "deferred";
  note_id: string | null;
  destination?: JobDestination | null; // preferred navigation target; note_id kept for back-compat
  title?: string | null; // display title, stamped by the worker on completion (older jobs lack it)
  error: string | null;
  attempt_count: number;
  created_at: Timestamp;
  updated_at?: Timestamp;
}

// One entry in the search_index — the backbone for semantic search, Clip AI grounding, and
// the "recent saves" strip. One doc per note, each with its own embedding. `ref_id` resolves
// back to the underlying note for display.
export interface SearchHit {
  id: string;
  user_id: string;
  kind: "note";
  ref_id: string; // id of the underlying note
  collection_id?: string | null; // mirrors the note's bucket
  title: string;
  summary?: string | null;
  cover_image_url?: string | null;
  created_at: Timestamp;
}
