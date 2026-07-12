import {
  ChefHat,
  Clapperboard,
  MapPin,
  Plane,
  ShoppingBag,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

// The six app-backed collections ("tools"). This is the single source of truth for their
// identity — label, route, icon, and the domain color each wears. Every surface (Launchpad
// tiles, tool-screen headers, search-result groups) reads from here so they never drift.
//
// NOTE: Tailwind's JIT needs *literal* class strings to emit the utilities, so each tool spells
// out its color classes rather than composing them from the color name at runtime.
export type ToolKey = "notes" | "watchlist" | "wishlist" | "places" | "recipes" | "trips";

// Maps a search-index / mini-app `app` value to a tool. Notes carry app=null.
export type AppKey = "watchlist" | "wishlist" | "places" | "recipes" | "trips";

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
    key: "wishlist",
    app: "wishlist",
    label: "Wishlist",
    desc: "Things to buy",
    to: "/wishlist",
    icon: ShoppingBag,
    fill: "bg-product text-product-on",
    soft: "bg-product-soft text-product-chip",
    text: "text-product",
    dot: "bg-product",
    wash: "border-product/15 bg-product-soft",
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
  {
    key: "recipes",
    app: "recipes",
    label: "Recipes",
    desc: "Dishes to cook",
    to: "/recipes",
    icon: ChefHat,
    fill: "bg-recipe text-recipe-on",
    soft: "bg-recipe-soft text-recipe-chip",
    text: "text-recipe",
    dot: "bg-recipe",
    wash: "border-recipe/15 bg-recipe-soft",
  },
  {
    key: "trips",
    app: "trips",
    label: "Trips",
    desc: "Travel plans",
    to: "/trips",
    icon: Plane,
    fill: "bg-trip text-trip-on",
    soft: "bg-trip-soft text-trip-chip",
    text: "text-trip",
    dot: "bg-trip",
    wash: "border-trip/15 bg-trip-soft",
  },
];

const BY_APP = new Map<AppKey, ToolMeta>(
  TOOLS.filter((t): t is ToolMeta & { app: AppKey } => t.app != null).map((t) => [t.app, t]),
);

/** Resolve a mini-app `app` value (from a search hit / item) to its tool identity. */
export function toolByApp(app: string | null | undefined): ToolMeta {
  return (app && BY_APP.get(app as AppKey)) || TOOLS[0]; // fall back to Notes
}

const BY_KEY = new Map<ToolKey, ToolMeta>(TOOLS.map((t) => [t.key, t]));

/** A tool by its own key — for screens that ARE the tool (wall headers etc.). */
export function toolByKey(key: ToolKey): ToolMeta {
  return BY_KEY.get(key) ?? TOOLS[0];
}

/** Resolve a search hit's `kind` (`note`/`watch`/`wish`/…) or `app` to its tool. */
export function toolForHit(app: string | null | undefined): ToolMeta {
  return app ? toolByApp(app) : TOOLS[0];
}
