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
  /** @deprecated transition shim only — kept coherent by the backend as `collection_ids[0]` or
   * null. Read `collection_ids` instead; this stays only for reading not-yet-migrated docs. */
  collection_id?: string | null;
  // Multi-home smart-bucket membership (backend-written: embedding match at ingest, reconciled
  // by rescore, pin/exclude overrides). A note can belong to more than one collection now;
  // absent/empty → lives in the Notes catch-all.
  collection_ids?: string[];

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

// One row in a digest's at-a-glance facts grid (rendered like GenericNote's facts block).
export interface DigestFact {
  label: string;
  value: string;
}

// One entry in a digest section: deep-links to the source note.
export interface DigestEntry {
  title: string;
  summary: string;
  note_id: string;
}

export interface DigestSection {
  heading: string;
  items: DigestEntry[];
}

// A collection's "living view" — one composed read built from its member notes by
// `POST /api/collections/{id}/digest`, and mirrored onto `collections/{id}.digest` so the
// existing `watchCollections` subscription streams it live with no extra listener.
// `source_note_ids` is the membership signature the digest was built against — compare it to
// the collection's live member ids to detect staleness. `generated_at` is a Firestore Timestamp.
export interface CollectionDigest {
  intro: string;
  facts: DigestFact[];
  sections: DigestSection[];
  coverage: string | null;
  source_note_ids: string[];
  generated_at?: Timestamp;
  model?: string;
}

// A user-created smart bucket. Owner-writable directly from the client for its presentation
// (name/icon/palette/description); membership is no longer stored here — notes carry
// `collection_ids` (multi-home, backend-written: embedding match + rescore + pin/exclude
// overrides), so the collection view is a live query. `topic_query`/`topic_embedding`/
// `pinned_note_ids`/`excluded_note_ids` are backend-only fields the client never reads directly.
// `note_ids` is retained (optional) only for reading legacy docs during migration.
export interface Collection {
  id: string;
  user_id: string;
  name: string;
  description?: string | null; // steers the AI classifier + creation-time backfill matching
  icon: string | null;
  palette: number | null;
  note_ids?: string[]; // legacy membership (pre-collection_id); migrated onto notes, then unused
  digest?: CollectionDigest | null; // the living-view composition; absent until first build
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

// ─── Mini-app item types (restored) ───────────────────────────────────────
// The watchlist/places apps read per-item docs from users/{uid}/<app>_items.
// Backend-write-only; client reads live via onSnapshot. Wishlist/Recipes/Trips item types were
// removed with those tiles; the itinerary note's TripStop/TripDay shapes below stay — they're
// note data, not a mini-app.

// One tracked movie/show in the Watchlist mini-app. Lives at users/{uid}/watch_items/{id},
// auto-populated by the worker from entertainment notes (one note → N items) and TMDB-enriched.
// Read-only on the client; watched/rating changes go through the backend.
export interface WatchItem {
  id: string;
  user_id: string;
  source_note_ids: string[]; // the note(s) this title was recommended in
  source_url?: string | null; // the captured link (reel/listicle) the title came from
  source_domain?: string | null;
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
  watch_status: "saved" | "to_watch" | "watching" | "watched";
  watched_at?: Timestamp | null;
  rating?: number | null; // 1–5, set on watched items
  favorite?: boolean; // cross-cutting ⭐ flag, independent of bucket
  added_manually?: boolean; // added via TMDB search rather than a note
  created_at: Timestamp;
  updated_at: Timestamp;
}

// One tracked venue in the Places mini-app. Lives at users/{uid}/place_items/{id},
// auto-populated by the worker from place notes (one note → N venues) and Google-Places-enriched.
// Read-only on the client; promote / visit / rating / notes changes go through the backend.
export interface PlaceItem {
  id: string;
  user_id: string;
  source_note_ids: string[]; // the note(s) this venue was recommended in
  place_id?: string; // Google place id (dedup key) when matched
  name: string;
  location?: string | null;
  city?: string | null;
  category?: string | null;
  cuisine?: string | null;
  formatted_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  photo_url?: string | null; // keyless googleusercontent URL
  rating?: number | null; // Google rating (0–5), display-only
  user_rating_count?: number | null;
  price_level?: string | null; // "$" … "$$$$"
  price_for_two?: string | null; // from the source, e.g. "₹1,500 for two"
  opening_hours?: string[]; // weekday descriptions
  website?: string | null;
  phone?: string | null;
  google_maps_url?: string | null;
  reservable?: boolean | null;
  must_try?: string[];
  good_for?: string[];
  best_time?: string | null;
  highlights?: string[];
  tips?: string[];
  why?: string | null;
  action_links?: PlaceAction[];
  added_manually?: boolean;
  place_status: "saved" | "to_visit" | "visited"; // bucket; "visited"/Been is a sticky attribute
  user_rating?: number | null; // 1–5 personal rating, set on visited
  user_notes?: string | null; // your free-text note
  favorite?: boolean; // cross-cutting ⭐ flag, independent of bucket
  visit_count?: number; // how many times you've been (revisitable); 0 until first Been
  visited_at?: Timestamp | null; // the *last* visit timestamp
  created_at: Timestamp;
  updated_at: Timestamp;
}

// One cast member on the detail page.
export interface CastMember {
  name: string;
  character?: string | null;
  profile_url?: string | null;
}

// Rich TMDB details fetched on demand for the movie-detail page (not stored on the item).
export interface WatchItemDetails {
  tmdb_id?: number;
  media_type?: "movie" | "tv";
  title?: string;
  year?: string | null;
  tagline?: string | null;
  overview?: string | null;
  poster_url?: string | null;
  backdrop_url?: string | null;
  genres?: string[];
  runtime?: number | null; // minutes (movie)
  number_of_seasons?: number | null; // tv
  number_of_episodes?: number | null; // tv
  episode_run_time?: number | null; // minutes/ep (tv)
  status?: string | null;
  vote_average?: number | null; // TMDB rating /10
  vote_count?: number | null;
  cast?: CastMember[];
}

// A TMDB search candidate shown in the manual-add picker.
export interface TmdbSearchResult {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  year?: string | null;
  poster_url?: string | null;
  overview?: string | null;
}

// A Google Places search candidate shown in the manual-add picker.
export interface PlaceSearchResult {
  place_id: string;
  name: string;
  formatted_address?: string | null;
  rating?: number | null;
  price_level?: string | null;
  category?: string | null;
}

// Rich Google Place details fetched on demand for the place-detail page (not stored on the item).
export interface PlaceItemDetails {
  place_id?: string;
  name?: string;
  formatted_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
  price_level?: string | null;
  category?: string | null;
  opening_hours?: string[];
  website?: string | null;
  phone?: string | null;
  google_maps_url?: string | null;
  editorial_summary?: string | null;
  reservable?: boolean | null;
  photo_url?: string | null;
}
