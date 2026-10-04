import {
  Bookmark,
  ChefHat,
  ShoppingBag,
  FileText,
  Dumbbell,
  MessageSquare,
  GraduationCap,
  BookOpen,
  Landmark,
  Sparkles,
  Briefcase,
  Clapperboard,
  AppWindow,
  Compass,
  Bot,
  Baby,
  Camera,
  Car,
  CalendarDays,
  Code2,
  Cpu,
  FlaskConical,
  Gamepad2,
  Globe,
  Hammer,
  HeartPulse,
  Home,
  Leaf,
  Lightbulb,
  Megaphone,
  Mic,
  Music,
  Newspaper,
  Palette,
  PawPrint,
  PiggyBank,
  Plane,
  Rocket,
  Shirt,
  Star,
  Tag,
  TrendingUp,
  Trophy,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import type { Note } from "@/lib/types";

export interface NoteAccent {
  dot: string;
  chip: string;
  ring: string;
  text: string;
  soft: string;
  border: string;
  /** foreground for a solid `dot`/`bg-{x}` fill — WCAG-safe (paper or ink per accent/mode). */
  on: string;
  /** tile surface: domain-tinted card background + matching border (home collection tiles). */
  wash: string;
}

const PALETTES: NoteAccent[] = [
  {
    dot: "bg-recipe",
    chip: "bg-recipe-soft text-recipe-chip",
    ring: "group-hover:ring-recipe/30",
    text: "text-recipe",
    soft: "bg-recipe-soft/40",
    border: "border-recipe",
    on: "text-recipe-on",
    wash: "border-recipe/15 bg-recipe-soft",
  },
  {
    dot: "bg-place",
    chip: "bg-place-soft text-place-chip",
    ring: "group-hover:ring-place/30",
    text: "text-place",
    soft: "bg-place-soft/40",
    border: "border-place",
    on: "text-place-on",
    wash: "border-place/15 bg-place-soft",
  },
  {
    dot: "bg-product",
    chip: "bg-product-soft text-product-chip",
    ring: "group-hover:ring-product/30",
    text: "text-product",
    soft: "bg-product-soft/40",
    border: "border-product",
    on: "text-product-on",
    wash: "border-product/15 bg-product-soft",
  },
  {
    dot: "bg-summary",
    chip: "bg-summary-soft text-summary-chip",
    ring: "group-hover:ring-summary/30",
    text: "text-summary",
    soft: "bg-summary-soft/60",
    border: "border-summary",
    on: "text-summary-on",
    wash: "border-summary/15 bg-summary-soft",
  },
  {
    dot: "bg-media",
    chip: "bg-media-soft text-media-chip",
    ring: "group-hover:ring-media/30",
    text: "text-media",
    soft: "bg-media-soft/40",
    border: "border-media",
    on: "text-media-on",
    wash: "border-media/15 bg-media-soft",
  },
  {
    dot: "bg-tech",
    chip: "bg-tech-soft text-tech-chip",
    ring: "group-hover:ring-tech/30",
    text: "text-tech",
    soft: "bg-tech-soft/40",
    border: "border-tech",
    on: "text-tech-on",
    wash: "border-tech/15 bg-tech-soft",
  },
  {
    dot: "bg-business",
    chip: "bg-business-soft text-business-chip",
    ring: "group-hover:ring-business/30",
    text: "text-business",
    soft: "bg-business-soft/40",
    border: "border-business",
    on: "text-business-on",
    wash: "border-business/15 bg-business-soft",
  },
  {
    dot: "bg-health",
    chip: "bg-health-soft text-health-chip",
    ring: "group-hover:ring-health/30",
    text: "text-health",
    soft: "bg-health-soft/40",
    border: "border-health",
    on: "text-health-on",
    wash: "border-health/15 bg-health-soft",
  },
  {
    dot: "bg-trip",
    chip: "bg-trip-soft text-trip-chip",
    ring: "group-hover:ring-trip/30",
    text: "text-trip",
    soft: "bg-trip-soft/40",
    border: "border-trip",
    on: "text-trip-on",
    wash: "border-trip/15 bg-trip-soft",
  },
];

// Known categories: a fixed icon + palette, and optionally a short display label
// (slugs like "entertainment-recommendations" render as "Entertainment").
const KNOWN: Record<string, { icon: LucideIcon; palette: number; label?: string }> = {
  bookmark: { icon: Bookmark, palette: 3 }, // salvage notes from the backend
  note: { icon: FileText, palette: 3, label: "Note" }, // save-as-is typed notes (no AI)
  recipe: { icon: ChefHat, palette: 0 },
  // Trips mini-app: itinerary notes ARE trips — Plane + sky-blue (palette 8), distinct from the
  // Places app which keeps the sage/map identity (the `place` slug below stays on palette 1).
  itinerary: { icon: Plane, palette: 8, label: "Trips" },
  trip: { icon: Plane, palette: 8, label: "Trips" },
  travel: { icon: Plane, palette: 8, label: "Travel" },
  product: { icon: ShoppingBag, palette: 2 },
  summary: { icon: FileText, palette: 3 },
  workout: { icon: Dumbbell, palette: 7 },
  place: { icon: Landmark, palette: 1, label: "Places" },
  book: { icon: BookOpen, palette: 3 },
  ai: { icon: Bot, palette: 5, label: "AI" },
  "educational-tutorial": { icon: GraduationCap, palette: 5, label: "Learning" },
  "fitness-discussion": { icon: MessageSquare, palette: 7, label: "Fitness" },
  "business-advice": { icon: Briefcase, palette: 6, label: "Business" },
  entertainment: { icon: Clapperboard, palette: 4, label: "Entertainment" },
  "entertainment-recommendations": { icon: Clapperboard, palette: 4, label: "Entertainment" },
  "software-recommendations": { icon: AppWindow, palette: 5, label: "Software" },
  "travel-destination-guide": { icon: Compass, palette: 1, label: "Travel" },
};

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// AI-invented categories get a stable icon + palette without any code change.
export function noteAccent(contentType: string): NoteAccent {
  const known = KNOWN[contentType];
  const idx = known ? known.palette : hashSlug(contentType) % PALETTES.length;
  return PALETTES[idx];
}

// Keyword → icon for invented slugs ("home-renovation-ideas" → Hammer). First
// matching word wins, so put the most specific sense of an ambiguous word here.
const WORD_ICONS: Record<string, LucideIcon> = {
  recipe: ChefHat,
  cooking: ChefHat,
  baking: ChefHat,
  food: UtensilsCrossed,
  restaurant: UtensilsCrossed,
  dining: UtensilsCrossed,
  travel: Compass,
  trip: Plane,
  flight: Plane,
  vacation: Plane,
  fitness: Dumbbell,
  gym: Dumbbell,
  exercise: Dumbbell,
  health: HeartPulse,
  wellness: HeartPulse,
  yoga: HeartPulse,
  mental: HeartPulse,
  finance: PiggyBank,
  financial: PiggyBank,
  saving: PiggyBank,
  investing: TrendingUp,
  investment: TrendingUp,
  stock: TrendingUp,
  stocks: TrendingUp,
  money: Wallet,
  budget: Wallet,
  news: Newspaper,
  politics: Landmark,
  history: Landmark,
  podcast: Mic,
  interview: Mic,
  music: Music,
  song: Music,
  playlist: Music,
  movie: Clapperboard,
  film: Clapperboard,
  tv: Clapperboard,
  photo: Camera,
  photography: Camera,
  art: Palette,
  design: Palette,
  craft: Palette,
  science: FlaskConical,
  research: FlaskConical,
  gaming: Gamepad2,
  game: Gamepad2,
  games: Gamepad2,
  fashion: Shirt,
  style: Shirt,
  outfit: Shirt,
  home: Home,
  interior: Home,
  decor: Home,
  diy: Hammer,
  renovation: Hammer,
  repair: Hammer,
  garden: Leaf,
  gardening: Leaf,
  plant: Leaf,
  plants: Leaf,
  sustainability: Leaf,
  parenting: Baby,
  kids: Baby,
  baby: Baby,
  pet: PawPrint,
  pets: PawPrint,
  dog: PawPrint,
  cat: PawPrint,
  car: Car,
  cars: Car,
  auto: Car,
  automotive: Car,
  bike: Car,
  sports: Trophy,
  sport: Trophy,
  cricket: Trophy,
  football: Trophy,
  event: CalendarDays,
  events: CalendarDays,
  festival: CalendarDays,
  tech: Cpu,
  technology: Cpu,
  gadget: Cpu,
  gadgets: Cpu,
  coding: Code2,
  programming: Code2,
  developer: Code2,
  software: AppWindow,
  app: AppWindow,
  career: Briefcase,
  job: Briefcase,
  jobs: Briefcase,
  business: Briefcase,
  startup: Rocket,
  entrepreneurship: Rocket,
  marketing: Megaphone,
  social: Megaphone,
  book: BookOpen,
  books: BookOpen,
  reading: BookOpen,
  learning: GraduationCap,
  education: GraduationCap,
  course: GraduationCap,
  tutorial: GraduationCap,
  productivity: Lightbulb,
  motivation: Lightbulb,
  idea: Lightbulb,
  ideas: Lightbulb,
  culture: Globe,
  language: Globe,
  world: Globe,
};

// Last resort for slugs with no recognizable keyword: a stable pick from a small
// varied pool, so unknown types still don't all collapse to one sparkle.
const FALLBACK_ICONS: LucideIcon[] = [Sparkles, Star, Tag, Lightbulb, Globe, Bookmark];

export function noteIcon(contentType: string): LucideIcon {
  const known = KNOWN[contentType]?.icon;
  if (known) return known;
  for (const word of contentType.split("-")) {
    const icon = WORD_ICONS[word];
    if (icon) return icon;
  }
  return FALLBACK_ICONS[hashSlug(contentType) % FALLBACK_ICONS.length];
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
