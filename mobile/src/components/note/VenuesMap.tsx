import { useMemo } from "react";
import { MapView, type MapPin } from "@/components/shared/MapView";

// The subset of a place note's `data.venues[]` entry the map needs. Coordinates are filled in by
// backend enrichment (Google Places); venues without them are absent from the map but still render
// in the venue list. Port of frontend/src/components/note/VenuesMap.tsx.
export interface MappableVenue {
  name?: string;
  city?: string | null;
  category?: string | null;
  cuisine?: string | null;
  rating?: number | string | null;
  price_level?: string | null;
  lat?: number | null;
  lng?: number | null;
}

// Single sage pin colour for a place note's venues (mirrors frontend/src/lib/map-colors.ts
// VENUE_PIN_COLOR — matches the place accent). Ported inline since the map engine can't read tokens.
const VENUE_PIN_COLOR = "#3c7b54";

function hasCoords(v: MappableVenue): boolean {
  return typeof v.lat === "number" && typeof v.lng === "number" && !!v.name;
}

// A live map of a place note's venues. Pins are numbered by each venue's position in the FULL list
// (gaps preserved when a venue lacks coordinates, so a pin's number matches the numbered venue
// section above). Renders nothing when fewer than two venues resolved to coordinates — a single
// venue leans on its Directions action instead. Exactly the web >=2-pins gate.
export function VenuesMap({ venues, height = 280 }: { venues: MappableVenue[]; height?: number }) {
  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    venues.forEach((v, i) => {
      if (!hasCoords(v)) return;
      const subtitle = [v.category || v.cuisine, v.city].filter(Boolean).join(" · ") || undefined;
      out.push({
        lat: v.lat as number,
        lng: v.lng as number,
        label: String(i + 1), // list index — matches the numbered venue above
        color: VENUE_PIN_COLOR,
        title: v.name,
        subtitle,
      });
    });
    return out;
  }, [venues]);

  if (pins.length < 2) return null;

  return <MapView pins={pins} height={height} />;
}
