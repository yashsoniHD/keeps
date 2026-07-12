import { Clapperboard, MapPin, StickyNote, type LucideIcon } from "lucide-react";

// The three app-backed collections ("tools"). This is the single source of truth for their
// identity — label, route, icon, and the domain color each wears. Every surface (Launchpad
// tiles, tool-screen headers, search-result groups) reads from here so they never drift.
//
// NOTE: Tailwind's JIT needs *literal* class strings to emit the utilities, so each tool spells
// out its color classes rather than composing them from the color name at runtime.
export type ToolKey = "notes" | "watchlist" | "places";

// Maps a search-index / mini-app `app` value to a tool. Notes carry app=null.
export type AppKey = "watchlist" | "places";

export interface ToolMeta {
  key: ToolKey;
  /** search_index `app` value (null for the Notes catch-all). */
  app: AppKey | null;
  label: string;
  desc: string;
  /** literal TanStack route path for the tool's index. */
  to: string;
  icon: LucideIcon;
  /** full-bleed color block: saturated fill + on-color foreground. */
  fill: string;
  /** light tint + colored text — for chips, washes, soft accents. */
  soft: string;
  /** colored text only. */
  text: string;
  /** the small swatch dot. */
  dot: string;
  /** tile surface: domain-tinted card background + matching border. */
  wash: string;
}

export const TOOLS: ToolMeta[] = [
  {
    key: "notes",
    app: null,
    label: "Notes",
    desc: "All saves",
    to: "/notes",
    icon: StickyNote,
    // The catch-all reads as neutral graphite — distinct from the colored domain tools.
    fill: "bg-ink text-paper",
    soft: "bg-muted text-ink-soft",
    text: "text-ink-soft",
    dot: "bg-ink",
    wash: "border-border bg-secondary/70",
  },
  {
    key: "watchlist",
    app: "watchlist",
    label: "Watchlist",
    desc: "Movies & shows",
    to: "/watchlist",
    icon: Clapperboard,
    fill: "bg-media text-media-on",
    soft: "bg-media-soft text-media-chip",
    text: "text-media",
    dot: "bg-media",
    wash: "border-media/15 bg-media-soft",
  },
  {
    key: "places",
    app: "places",
    label: "Places",
    desc: "Food & drink",
    to: "/places",
    icon: MapPin,
    fill: "bg-place text-place-on",
    soft: "bg-place-soft text-place-chip",
    text: "text-place",
    dot: "bg-place",
    wash: "border-place/15 bg-place-soft",
  },
];

const BY_KEY = new Map<ToolKey, ToolMeta>(TOOLS.map((t) => [t.key, t]));

/** A tool by its own key — for screens that ARE the tool (wall headers etc.). */
export function toolByKey(key: ToolKey): ToolMeta {
  return BY_KEY.get(key) ?? TOOLS[0];
}
