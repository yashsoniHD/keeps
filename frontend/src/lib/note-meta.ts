import {
  ChefHat,
  MapPin,
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
  type LucideIcon,
} from "lucide-react";
import type { Timestamp } from "firebase/firestore";

export interface NoteAccent {
  dot: string;
  chip: string;
  ring: string;
  text: string;
  soft: string;
}

const PALETTES: NoteAccent[] = [
  { dot: "bg-recipe", chip: "bg-recipe-soft text-recipe", ring: "group-hover:ring-recipe/30", text: "text-recipe", soft: "bg-recipe-soft/40" },
  { dot: "bg-itinerary", chip: "bg-itinerary-soft text-itinerary", ring: "group-hover:ring-itinerary/30", text: "text-itinerary", soft: "bg-itinerary-soft/40" },
  { dot: "bg-product", chip: "bg-product-soft text-product", ring: "group-hover:ring-product/30", text: "text-product", soft: "bg-product-soft/40" },
  { dot: "bg-summary", chip: "bg-summary-soft text-summary", ring: "group-hover:ring-summary/30", text: "text-summary", soft: "bg-summary-soft/60" },
  { dot: "bg-media", chip: "bg-media-soft text-media", ring: "group-hover:ring-media/30", text: "text-media", soft: "bg-media-soft/40" },
  { dot: "bg-tech", chip: "bg-tech-soft text-tech", ring: "group-hover:ring-tech/30", text: "text-tech", soft: "bg-tech-soft/40" },
  { dot: "bg-business", chip: "bg-business-soft text-business", ring: "group-hover:ring-business/30", text: "text-business", soft: "bg-business-soft/40" },
  { dot: "bg-health", chip: "bg-health-soft text-health", ring: "group-hover:ring-health/30", text: "text-health", soft: "bg-health-soft/40" },
];

// Known categories: a fixed icon + palette, and optionally a short display label
// (slugs like "entertainment-recommendations" render as "Entertainment").
const KNOWN: Record<string, { icon: LucideIcon; palette: number; label?: string }> = {
  recipe: { icon: ChefHat, palette: 0 },
  itinerary: { icon: MapPin, palette: 1 },
  product: { icon: ShoppingBag, palette: 2 },
  summary: { icon: FileText, palette: 3 },
  workout: { icon: Dumbbell, palette: 7 },
  place: { icon: Landmark, palette: 1 },
  book: { icon: BookOpen, palette: 3 },
  ai: { icon: Bot, palette: 5, label: "AI" },
  "educational-tutorial": { icon: GraduationCap, palette: 5, label: "Learning" },
  "fitness-discussion": { icon: MessageSquare, palette: 7, label: "Fitness" },
  "business-advice": { icon: Briefcase, palette: 6, label: "Business" },
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

export function noteIcon(contentType: string): LucideIcon {
  return KNOWN[contentType]?.icon ?? Sparkles;
}

// Filler words the AI tends to append to invented slugs; stripping them keeps
// chips short ("travel-destination-guide" → "Travel") without a per-slug mapping.
const LABEL_NOISE = new Set([
  "recommendation", "recommendations", "guide", "guides", "advice", "ideas",
  "tips", "list", "lists", "collection", "collections", "destination",
  "destinations", "discussion", "discussions", "tutorial", "tutorials",
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

export function sourceLabel(domain: string): string {
  const first = domain.replace(/^www\./, "").split(".")[0];
  return SOURCE_ALIASES[first] ?? first;
}

export function formatDate(ts?: Timestamp): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Compact variant for dense rows: "11 Jun", year only when it differs from today.
export function formatDateShort(ts?: Timestamp): string {
  if (!ts?.toDate) return "";
  const d = ts.toDate();
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "2-digit";
  return d.toLocaleDateString("en-IN", opts);
}
