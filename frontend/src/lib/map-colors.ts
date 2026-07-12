// Google Maps marker colours, defined once. The `<Pin>` background/glyph props are handed
// straight to the Maps JS API, which can't read CSS custom properties, so pins need literal hex
// strings — hence a shared constant module rather than theme-aware token reads.
import type { PlaceItem } from "@/lib/types";

// A repeating palette so each day's stops read as a group on the trip / itinerary map.
export const DAY_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
];

// Single sage pin for a place note's venues (matches the place accent).
export const VENUE_PIN_COLOR = "#5b8c5a";

// Place-wall markers coloured by bucket so the map reads at a glance.
export const PLACE_STATUS_PIN: Record<
  PlaceItem["place_status"],
  { background: string; glyph: string }
> = {
  saved: { background: "#9aa0a6", glyph: "#ffffff" },
  to_visit: { background: "#5b8c5a", glyph: "#ffffff" }, // itinerary sage
  visited: { background: "#2563eb", glyph: "#ffffff" },
};
