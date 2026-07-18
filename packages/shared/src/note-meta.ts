// Platform-neutral note-meta logic shared by the web app and the mobile app.
// Icons are referred to by lucide export NAME ("ChefHat") — `lucide-react` and
// `lucide-react-native` export identical names, so each app resolves names to its own
// components. Palettes are referred to by INDEX; each app owns its class-string/style table.
import type { TimestampLike as Timestamp } from "./timestamp";
import type { Note } from "./types";

export const PALETTE_COUNT = 9;

// Known categories: a fixed icon + palette, and optionally a short display label
// (slugs like "entertainment-recommendations" render as "Entertainment").
export const KNOWN: Record<string, { icon: string; palette: number; label?: string }> = {
  bookmark: { icon: "Bookmark", palette: 3 }, // salvage notes from the backend
  note: { icon: "FileText", palette: 3, label: "Note" }, // save-as-is typed notes (no AI)
  recipe: { icon: "ChefHat", palette: 0 },
  // Trips mini-app: itinerary notes ARE trips — Plane + sky-blue (palette 8), distinct from the
  // Places app which keeps the sage/map identity (the `place` slug below stays on palette 1).
  itinerary: { icon: "Plane", palette: 8, label: "Trips" },
  trip: { icon: "Plane", palette: 8, label: "Trips" },
  travel: { icon: "Plane", palette: 8, label: "Travel" },
  product: { icon: "ShoppingBag", palette: 2 },
  summary: { icon: "FileText", palette: 3 },
  workout: { icon: "Dumbbell", palette: 7 },
  place: { icon: "Landmark", palette: 1, label: "Places" },
  book: { icon: "BookOpen", palette: 3 },
  ai: { icon: "Bot", palette: 5, label: "AI" },
  "educational-tutorial": { icon: "GraduationCap", palette: 5, label: "Learning" },
  "fitness-discussion": { icon: "MessageSquare", palette: 7, label: "Fitness" },
  "business-advice": { icon: "Briefcase", palette: 6, label: "Business" },
  entertainment: { icon: "Clapperboard", palette: 4, label: "Entertainment" },
  "entertainment-recommendations": { icon: "Clapperboard", palette: 4, label: "Entertainment" },
  "software-recommendations": { icon: "AppWindow", palette: 5, label: "Software" },
  "travel-destination-guide": { icon: "Compass", palette: 1, label: "Travel" },
};

export function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// --- User overrides ------------------------------------------------------------
// A category's icon + palette are auto-derived from its slug (above). But a user can
// pin their own choice per category (Manage categories → pick icon/colour). Those live
// on users/{uid}.category_meta and are loaded once into this module-level registry;
// noteIconName/paletteIndexFor consult it first so the choice shows app-wide.
export type CategoryMeta = { icon?: string; palette?: number };
let OVERRIDES: Record<string, CategoryMeta> = {};

export function setCategoryOverrides(map: Record<string, CategoryMeta> | null | undefined) {
  OVERRIDES = map ?? {};
}

// The curated icon set offered in the picker, by stable lucide export name (that name is
// what's persisted). Kept to a tidy, recognisable spread rather than all of lucide.
export const CATEGORY_ICON_NAMES: string[] = [
  "Sparkles",
  "Bookmark",
  "Star",
  "Tag",
  "Lightbulb",
  "ChefHat",
  "UtensilsCrossed",
  "MapPin",
  "Compass",
  "Plane",
  "ShoppingBag",
  "Wallet",
  "PiggyBank",
  "TrendingUp",
  "Briefcase",
  "FileText",
  "BookOpen",
  "GraduationCap",
  "Newspaper",
  "Mic",
  "Dumbbell",
  "HeartPulse",
  "Trophy",
  "Baby",
  "PawPrint",
  "Clapperboard",
  "Music",
  "Gamepad2",
  "Camera",
  "Palette",
  "Cpu",
  "Code2",
  "AppWindow",
  "Bot",
  "Rocket",
  "Home",
  "Hammer",
  "Leaf",
  "Car",
  "Shirt",
  "Landmark",
  "Globe",
  "FlaskConical",
  "Megaphone",
  "CalendarDays",
  "MessageSquare",
];

// A stable default palette for a user-named thing (collections): the name hashes to a colour
// so nothing ever renders gray-by-omission, while an explicit pick still wins.
export function defaultPaletteFor(name: string): number {
  return hashSlug(name.trim().toLowerCase()) % PALETTE_COUNT;
}

// AI-invented categories get a stable palette without any code change — unless the
// user has pinned a palette for the slug, which wins.
export function paletteIndexFor(contentType: string): number {
  const override = OVERRIDES[contentType]?.palette;
  if (override != null && override >= 0 && override < PALETTE_COUNT) return override;
  const known = KNOWN[contentType];
  return known ? known.palette : hashSlug(contentType) % PALETTE_COUNT;
}

// Keyword → icon name for invented slugs ("home-renovation-ideas" → Hammer). First
// matching word wins, so put the most specific sense of an ambiguous word here.
export const WORD_ICONS: Record<string, string> = {
  recipe: "ChefHat",
  cooking: "ChefHat",
  baking: "ChefHat",
  food: "UtensilsCrossed",
  restaurant: "UtensilsCrossed",
  dining: "UtensilsCrossed",
  travel: "Compass",
  trip: "Plane",
  flight: "Plane",
  vacation: "Plane",
  fitness: "Dumbbell",
  gym: "Dumbbell",
  exercise: "Dumbbell",
  health: "HeartPulse",
  wellness: "HeartPulse",
  yoga: "HeartPulse",
  mental: "HeartPulse",
  finance: "PiggyBank",
  financial: "PiggyBank",
  saving: "PiggyBank",
  investing: "TrendingUp",
  investment: "TrendingUp",
  stock: "TrendingUp",
  stocks: "TrendingUp",
  money: "Wallet",
  budget: "Wallet",
  news: "Newspaper",
  politics: "Landmark",
  history: "Landmark",
  podcast: "Mic",
  interview: "Mic",
  music: "Music",
  song: "Music",
  playlist: "Music",
  movie: "Clapperboard",
  film: "Clapperboard",
  tv: "Clapperboard",
  photo: "Camera",
  photography: "Camera",
  art: "Palette",
  design: "Palette",
  craft: "Palette",
  science: "FlaskConical",
  research: "FlaskConical",
  gaming: "Gamepad2",
  game: "Gamepad2",
  games: "Gamepad2",
  fashion: "Shirt",
  style: "Shirt",
  outfit: "Shirt",
  home: "Home",
  interior: "Home",
  decor: "Home",
  diy: "Hammer",
  renovation: "Hammer",
  repair: "Hammer",
  garden: "Leaf",
  gardening: "Leaf",
  plant: "Leaf",
  plants: "Leaf",
  sustainability: "Leaf",
  parenting: "Baby",
  kids: "Baby",
  baby: "Baby",
  pet: "PawPrint",
  pets: "PawPrint",
  dog: "PawPrint",
  cat: "PawPrint",
  car: "Car",
  cars: "Car",
  auto: "Car",
  automotive: "Car",
  bike: "Car",
  sports: "Trophy",
  sport: "Trophy",
  cricket: "Trophy",
  football: "Trophy",
  event: "CalendarDays",
  events: "CalendarDays",
  festival: "CalendarDays",
  tech: "Cpu",
  technology: "Cpu",
  gadget: "Cpu",
  gadgets: "Cpu",
  coding: "Code2",
  programming: "Code2",
  developer: "Code2",
  software: "AppWindow",
  app: "AppWindow",
  career: "Briefcase",
  job: "Briefcase",
  jobs: "Briefcase",
  business: "Briefcase",
  startup: "Rocket",
  entrepreneurship: "Rocket",
  marketing: "Megaphone",
  social: "Megaphone",
  book: "BookOpen",
  books: "BookOpen",
  reading: "BookOpen",
  learning: "GraduationCap",
  education: "GraduationCap",
  course: "GraduationCap",
  tutorial: "GraduationCap",
  productivity: "Lightbulb",
  motivation: "Lightbulb",
  idea: "Lightbulb",
  ideas: "Lightbulb",
  culture: "Globe",
  language: "Globe",
  world: "Globe",
};

// Last resort for slugs with no recognizable keyword: a stable pick from a small
// varied pool, so unknown types still don't all collapse to one sparkle.
export const FALLBACK_ICON_NAMES: string[] = [
  "Sparkles",
  "Star",
  "Tag",
  "Lightbulb",
  "Globe",
  "Bookmark",
];

export function noteIconName(contentType: string): string {
  const pinned = OVERRIDES[contentType]?.icon;
  if (pinned && CATEGORY_ICON_NAMES.includes(pinned)) return pinned;
  const known = KNOWN[contentType]?.icon;
  if (known) return known;
  for (const word of contentType.split("-")) {
    const icon = WORD_ICONS[word];
    if (icon) return icon;
  }
  return FALLBACK_ICON_NAMES[hashSlug(contentType) % FALLBACK_ICON_NAMES.length];
}

// Filler words the AI tends to append to invented slugs; stripping them keeps
// chips short ("travel-destination-guide" → "Travel") without a per-slug mapping.
const LABEL_NOISE = new Set([
  "recommendation",
  "recommendations",
  "guide",
  "guides",
  "advice",
  "ideas",
  "tips",
  "list",
  "lists",
  "collection",
  "collections",
  "destination",
  "destinations",
  "discussion",
  "discussions",
  "tutorial",
  "tutorials",
]);

export function noteLabel(contentType: string): string {
  const override = KNOWN[contentType]?.label;
  if (override) return override;
  let words = contentType.split("-").filter((w) => !LABEL_NOISE.has(w));
  if (words.length === 0) words = contentType.split("-");
  return words
    .slice(0, 2)
    .map((w) => (w === "ai" ? "AI" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// "instagram.com" → "instagram", "amzn.in" → "amazon". The full domain stays in
// the data; this is display-only.
const SOURCE_ALIASES: Record<string, string> = {
  amzn: "amazon",
  youtu: "youtube", // youtu.be
  fb: "facebook",
};

// Country-code second-level labels ("amazon.co.uk") that aren't the brand.
const SECOND_LEVEL_TLDS = new Set(["co", "com", "net", "org", "ac", "gov", "edu"]);

// The brand is the registrable label, not the first one — "open.substack.com"
// must read "substack", not "open".
export function sourceLabel(domain: string): string {
  const parts = domain
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  let label = parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? domain);
  if (SECOND_LEVEL_TLDS.has(label) && parts.length >= 3) label = parts[parts.length - 3];
  return SOURCE_ALIASES[label] ?? label;
}

export function formatDate(ts?: Timestamp): string {
  if (!ts?.toDate) return "";
  return ts
    .toDate()
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Compact variant for dense rows: "11 Jun", year only when it differs from today.
export function formatDateShort(ts?: Timestamp): string {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "2-digit";
  return d.toLocaleDateString("en-IN", opts);
}

export interface NoteGroup {
  key: string;
  label: string;
  notes: Note[];
}

// Bucket a feed (already sorted newest-first) into dated sections so the home screen
// reads as recent activity rather than one endless list: Today / Yesterday / This Week /
// This Month / "Month YYYY" for older. Order follows first-appearance, which — given the
// pre-sorted input — is already newest group first, with each group's notes still in order.
const DAY_MS = 86_400_000;

export function groupNotesByDate(notes: Note[]): NoteGroup[] {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const yesterday = today - DAY_MS;
  const weekStart = today - 6 * DAY_MS; // today + the previous 6 days count as "this week"

  const order: string[] = [];
  const groups = new Map<string, NoteGroup>();
  const add = (key: string, label: string, note: Note) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, label, notes: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.notes.push(note);
  };

  for (const n of notes) {
    const d = n.created_at?.toDate?.();
    if (!d) {
      add("earlier", "Earlier", n);
      continue;
    }
    const day = startOfDay(d);
    if (day === today) add("today", "Today", n);
    else if (day === yesterday) add("yesterday", "Yesterday", n);
    else if (day >= weekStart) add("week", "This Week", n);
    else if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())
      add("month", "This Month", n);
    else {
      add(
        `${d.getFullYear()}-${d.getMonth()}`,
        d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
        n,
      );
    }
  }

  return order.map((k) => groups.get(k)!);
}

export interface CategoryGroup {
  label: string;
  slugs: string[]; // every content_type slug that collapsed into this label
  notes: Note[];
}

// Bucket a feed (already sorted newest-first) into category shelves for the Shelves view.
// Groups collapse by display label — the same rule as the filter chips — so "itinerary" and
// "trip" land on one "Trips" shelf instead of two near-duplicates. Shelf order follows first
// appearance in the pre-sorted input, so the category with the newest note sits on top.
export function groupNotesByCategory(notes: Note[]): CategoryGroup[] {
  const order: string[] = [];
  const groups = new Map<string, CategoryGroup>();
  for (const n of notes) {
    const label = noteLabel(n.content_type);
    let g = groups.get(label);
    if (!g) {
      g = { label, slugs: [], notes: [] };
      groups.set(label, g);
      order.push(label);
    }
    if (!g.slugs.includes(n.content_type)) g.slugs.push(n.content_type);
    g.notes.push(n);
  }
  return order.map((k) => groups.get(k)!);
}
