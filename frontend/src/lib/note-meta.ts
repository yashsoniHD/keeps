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
];

const KNOWN: Record<string, { icon: LucideIcon; palette: number }> = {
  recipe: { icon: ChefHat, palette: 0 },
  itinerary: { icon: MapPin, palette: 1 },
  product: { icon: ShoppingBag, palette: 2 },
  summary: { icon: FileText, palette: 3 },
  workout: { icon: Dumbbell, palette: 0 },
  place: { icon: Landmark, palette: 1 },
  book: { icon: BookOpen, palette: 3 },
  "educational-tutorial": { icon: GraduationCap, palette: 3 },
  "fitness-discussion": { icon: MessageSquare, palette: 0 },
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

export function noteLabel(contentType: string): string {
  return contentType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDate(ts?: Timestamp): string {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
