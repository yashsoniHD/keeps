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
  watch_status: "saved" | "to_watch" | "watching" | "watched";
  watched_at?: Timestamp | null;
  rating?: number | null; // 1–5, set on watched items
  favorite?: boolean; // cross-cutting ⭐ flag, independent of bucket
  added_manually?: boolean; // added via TMDB search rather than a note
  created_at: Timestamp;
  updated_at: Timestamp;
}

// One spec row on a product.
export interface ProductSpec {
  label: string;
  value: string;
}

// One tracked product in the Wishlist mini-app. Lives at users/{uid}/wish_items/{id},
// auto-populated by the worker from product notes (one product note → one item). Read-only on
// the client; promote / mark-bought / target-price changes go through the backend.
export interface WishItem {
  id: string;
  user_id: string;
  source_note_ids: string[]; // the note(s) this product came from
  title: string;
  brand?: string | null;
  image_url?: string | null;
  buy_url?: string | null;
  domain?: string | null;
  price_raw?: string | null; // as shown, e.g. "₹2,499"
  price_amount?: number | null; // parsed numeric, for sorting / drop-detection
  currency?: string | null;
  rating?: number | null; // the product's own review rating (0–5), display-only
  specs?: ProductSpec[];
  pros?: string[];
  cons?: string[];
  verdict?: string | null;
  wish_status: "saved" | "to_buy" | "purchased"; // mutually-exclusive bucket
  favorite?: boolean; // cross-cutting ⭐ flag, independent of bucket
  target_price?: number | null; // user's price-alert target (Phase B)
  price_when_added?: number | null; // anchor for "cheaper than when you saved it"
  purchased_at?: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// One tracked recipe in the Recipes mini-app. Lives at users/{uid}/recipe_items/{id},
// auto-populated by the worker from recipe notes (one note → one recipe) as a pure copy of the
// note's already-extracted fields — no external API. Read-only on the client; the favorite toggle
// goes through the backend. Recipes have no status workflow (no buckets), so `favorite` is the only
// owner-editable field — the cookbook is organised by filters + favorites instead.
export interface RecipeItem {
  id: string;
  user_id: string;
  source_note_ids: string[]; // the note(s) this recipe came from
  title: string;
  cuisine?: string | null;
  image_url?: string | null;
  source_url?: string | null;
  domain?: string | null;
  total_time?: string | null; // e.g. "35 min"
  prep_time?: string | null;
  cook_time?: string | null;
  servings?: string | null;
  difficulty?: string | null; // Easy | Medium | Hard
  calories?: string | null;
  ingredients?: { group?: string; items: string[] }[];
  steps?: string[];
  tips?: string[];
  favorite?: boolean; // cross-cutting ⭐ flag
  created_at: Timestamp;
  updated_at: Timestamp;
}

// One stop on a trip day. `lat`/`lng` are filled in by the worker (Google Places geocode of the
// place name) so the detail map can plot it; missing when the stop didn't resolve.
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

// One tracked trip in the Trips mini-app. Lives at users/{uid}/trip_items/{id}, auto-populated by
// the worker from itinerary notes (one note → one trip) — a near-pure copy of the note's extracted
// fields, with each stop geocoded for the map. Read-only on the client; the favorite toggle goes
// through the backend. Trips have no status workflow (no buckets), so `favorite` is the only
// owner-editable field — the wall is organised by filters + favorites instead.
export interface TripItem {
  id: string;
  user_id: string;
  source_note_ids: string[]; // the note(s) this trip came from
  title: string;
  destination?: string | null;
  duration?: string | null; // e.g. "3 days"
  budget?: string | null;
  best_season?: string | null;
  image_url?: string | null;
  source_url?: string | null;
  domain?: string | null;
  days?: TripDay[];
  tips?: string[];
  favorite?: boolean; // cross-cutting ⭐ flag
  created_at: Timestamp;
  updated_at: Timestamp;
}

// One action on a place item's row (region-aware): Directions / Reserve / Order / Website /
// Instagram / Call. Built by the backend so the frontend needs no platform knowledge.
export interface PlaceAction {
  label: string;
  url: string;
  kind: "directions" | "reserve" | "order" | "website" | "instagram" | "call";
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

// Where a completed capture landed, written by the worker so the frontend can navigate without
// assuming a note exists (mini-app captures produce items, not notes).
export interface JobDestination {
  kind: "note" | "app";
  app?: "recipes" | "watchlist" | "wishlist" | "places" | "trips"; // set when kind === "app"
  item_id?: string; // set only when the capture produced exactly one mini-app item
  note_id?: string; // set when kind === "note"
}

export interface Job {
  id: string;
  user_id: string;
  url: string;
  status: "pending" | "processing" | "completed" | "failed" | "deferred";
  note_id: string | null;
  destination?: JobDestination | null; // preferred navigation target; note_id kept for back-compat
  error: string | null;
  attempt_count: number;
  created_at: Timestamp;
  updated_at?: Timestamp;
}

// One entry in the unified search_index — the backbone for semantic search, Clip AI grounding, and
// the Library "recent saves" strip. One doc per note OR mini-app item, each with its own embedding.
// `kind`+`ref_id` resolve back to the underlying note/item for display; `app` routes mini-app hits.
export interface SearchHit {
  id: string;
  user_id: string;
  kind: "note" | "watch" | "wish" | "recipe" | "place" | "trip";
  ref_id: string; // id of the underlying note or *_items doc
  app?: "recipes" | "watchlist" | "wishlist" | "places" | "trips" | null; // null for plain notes
  collection_id?: string | null; // mirrors the note's bucket (notes only)
  title: string;
  summary?: string | null;
  cover_image_url?: string | null;
  created_at: Timestamp;
}
