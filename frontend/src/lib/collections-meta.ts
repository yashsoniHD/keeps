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
  },
  {
    key: "watchlist",
    app: "watchlist",
    label: "Watchlist",
    desc: "Movies & shows",
    to: "/watchlist",
    icon: Clapperboard,
    fill: "bg-media text-white",
    soft: "bg-media-soft text-media",
    text: "text-media",
    dot: "bg-media",
  },
  {
    key: "wishlist",
    app: "wishlist",
    label: "Wishlist",
    desc: "Things to buy",
    to: "/wishlist",
    icon: ShoppingBag,
    fill: "bg-product text-white",
    soft: "bg-product-soft text-product",
    text: "text-product",
    dot: "bg-product",
  },
  {
    key: "places",
    app: "places",
    label: "Places",
    desc: "Food & drink",
    to: "/places",
    icon: MapPin,
    fill: "bg-itinerary text-white",
    soft: "bg-itinerary-soft text-itinerary",
    text: "text-itinerary",
    dot: "bg-itinerary",
  },
  {
    key: "recipes",
    app: "recipes",
    label: "Recipes",
    desc: "Dishes to cook",
    to: "/recipes",
    icon: ChefHat,
    fill: "bg-recipe text-white",
    soft: "bg-recipe-soft text-recipe",
    text: "text-recipe",
    dot: "bg-recipe",
  },
  {
    key: "trips",
    app: "trips",
    label: "Trips",
    desc: "Travel plans",
    to: "/trips",
    icon: Plane,
    fill: "bg-trip text-white",
    soft: "bg-trip-soft text-trip",
    text: "text-trip",
    dot: "bg-trip",
  },
];

const BY_APP = new Map<AppKey, ToolMeta>(
  TOOLS.filter((t): t is ToolMeta & { app: AppKey } => t.app != null).map((t) => [t.app, t]),
);

/** Resolve a mini-app `app` value (from a search hit / item) to its tool identity. */
export function toolByApp(app: string | null | undefined): ToolMeta {
  return (app && BY_APP.get(app as AppKey)) || TOOLS[0]; // fall back to Notes
}

/** Resolve a search hit's `kind` (`note`/`watch`/`wish`/…) or `app` to its tool. */
export function toolForHit(app: string | null | undefined): ToolMeta {
  return app ? toolByApp(app) : TOOLS[0];
}
