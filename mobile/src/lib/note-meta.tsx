// Mobile bridge over @clipnote/shared note-meta logic: resolves palette indices to
// NativeWind class strings and icon names to lucide-react-native components. The class
// strings mirror frontend/src/lib/note-meta.ts PALETTES minus web-only utilities
// (group-hover ring states have no RN equivalent).
import * as Lucide from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { cssInterop } from "nativewind";
import {
  CATEGORY_ICON_NAMES,
  FALLBACK_ICON_NAMES,
  noteIconName,
  paletteIndexFor,
} from "@clipnote/shared";

export {
  defaultPaletteFor,
  formatDate,
  formatDateShort,
  groupNotesByCategory,
  groupNotesByDate,
  noteLabel,
  PALETTE_COUNT,
  setCategoryOverrides,
  sourceLabel,
  type CategoryGroup,
  type CategoryMeta,
  type NoteGroup,
} from "@clipnote/shared";

export interface NoteAccent {
  dot: string;
  chip: string;
  text: string;
  soft: string;
  border: string;
  /** foreground for a solid `dot`/`bg-{x}` fill — WCAG-safe (paper or ink per accent/mode). */
  on: string;
  /** tile surface: domain-tinted card background + matching border. */
  wash: string;
}

const PALETTES: NoteAccent[] = [
  {
    dot: "bg-recipe",
    chip: "bg-recipe-soft text-recipe-chip",
    text: "text-recipe",
    soft: "bg-recipe-soft/40",
    border: "border-recipe",
    on: "text-recipe-on",
    wash: "border-recipe/15 bg-recipe-soft",
  },
  {
    dot: "bg-place",
    chip: "bg-place-soft text-place-chip",
    text: "text-place",
    soft: "bg-place-soft/40",
    border: "border-place",
    on: "text-place-on",
    wash: "border-place/15 bg-place-soft",
  },
  {
    dot: "bg-product",
    chip: "bg-product-soft text-product-chip",
    text: "text-product",
    soft: "bg-product-soft/40",
    border: "border-product",
    on: "text-product-on",
    wash: "border-product/15 bg-product-soft",
  },
  {
    dot: "bg-summary",
    chip: "bg-summary-soft text-summary-chip",
    text: "text-summary",
    soft: "bg-summary-soft/60",
    border: "border-summary",
    on: "text-summary-on",
    wash: "border-summary/15 bg-summary-soft",
  },
  {
    dot: "bg-media",
    chip: "bg-media-soft text-media-chip",
    text: "text-media",
    soft: "bg-media-soft/40",
    border: "border-media",
    on: "text-media-on",
    wash: "border-media/15 bg-media-soft",
  },
  {
    dot: "bg-tech",
    chip: "bg-tech-soft text-tech-chip",
    text: "text-tech",
    soft: "bg-tech-soft/40",
    border: "border-tech",
    on: "text-tech-on",
    wash: "border-tech/15 bg-tech-soft",
  },
  {
    dot: "bg-business",
    chip: "bg-business-soft text-business-chip",
    text: "text-business",
    soft: "bg-business-soft/40",
    border: "border-business",
    on: "text-business-on",
    wash: "border-business/15 bg-business-soft",
  },
  {
    dot: "bg-health",
    chip: "bg-health-soft text-health-chip",
    text: "text-health",
    soft: "bg-health-soft/40",
    border: "border-health",
    on: "text-health-on",
    wash: "border-health/15 bg-health-soft",
  },
  {
    dot: "bg-trip",
    chip: "bg-trip-soft text-trip-chip",
    text: "text-trip",
    soft: "bg-trip-soft/40",
    border: "border-trip",
    on: "text-trip-on",
    wash: "border-trip/15 bg-trip-soft",
  },
];

export const PALETTE_DOTS = PALETTES.map((p) => p.dot);

// Third-party (SVG) components don't get className support automatically — NativeWind
// only wires core RN components. Register each icon once so classes like `text-recipe`
// actually reach the SVG `color` prop instead of silently rendering the default black.
// ANY screen that imports a lucide icon directly and styles it with className MUST pass
// it through interopIcon() once (module scope is fine) — see feed/settings for examples.
const interopRegistered = new WeakSet<object>();

export function interopIcon(icon: LucideIcon): LucideIcon {
  if (!interopRegistered.has(icon as object)) {
    cssInterop(icon, {
      className: { target: "style", nativeStyleToProp: { color: true } },
    });
    interopRegistered.add(icon as object);
  }
  return icon;
}

function iconComponent(name: string): LucideIcon | null {
  const icon = (Lucide as unknown as Record<string, LucideIcon>)[name];
  if (typeof icon !== "function" && typeof icon !== "object") return null;
  return icon ? interopIcon(icon) : null;
}

// The curated picker set, resolved to components (same names the web picker persists).
export const CATEGORY_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICON_NAMES.map((name) => [name, iconComponent(name)]).filter(
    (entry): entry is [string, LucideIcon] => entry[1] != null,
  ),
);

export function iconByName(name: string | null | undefined): LucideIcon | null {
  return (name && CATEGORY_ICONS[name]) || null;
}

// The accent for a specific palette index (for picker previews), safely wrapped.
export function paletteAccent(index: number): NoteAccent {
  return PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length];
}

export function noteAccent(contentType: string): NoteAccent {
  return PALETTES[paletteIndexFor(contentType)];
}

const FALLBACK: LucideIcon = Lucide.Sparkles;

export function noteIcon(contentType: string): LucideIcon {
  return (
    iconComponent(noteIconName(contentType)) ??
    iconComponent(FALLBACK_ICON_NAMES[0]) ??
    FALLBACK
  );
}
