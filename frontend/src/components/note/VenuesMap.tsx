import { useMemo } from "react";
import { Star } from "lucide-react";
import type { PlaceAction } from "@/lib/types";
import { VENUE_PIN_COLOR } from "@/lib/map-colors";
import { MapView, type MapPin } from "@/components/shared/MapView";
import { ActionRow } from "@/components/shared/ActionRow";

// The subset of a place note's `data.venues[]` entry the map needs. Coordinates are filled in
// by backend enrichment (Google Places); venues without them are absent from the map but still
// render in the venue list below.
export interface MappableVenue {
  name?: string;
  city?: string | null;
  category?: string | null;
  rating?: number | string | null;
  price_level?: string | null;
  photo_url?: string | null;
  lat?: number | null;
  lng?: number | null;
  action_links?: PlaceAction[];
}

type Pinned = MappableVenue & { name: string; lat: number; lng: number };

function hasCoords(v: MappableVenue): v is Pinned {
  return typeof v.lat === "number" && typeof v.lng === "number" && !!v.name;
}

// A live Google map of a place note's venues. Pins are numbered by each venue's position in
// the full list (gaps preserved when a venue lacks coordinates, so a pin's number matches the
// numbered article above). Renders nothing when fewer than two venues resolved to coordinates —
// a single-venue note gets no map (its Directions action covers it). Shows the shared fallback
// when a browser Maps key is missing or the API fails to load.
export function VenuesMap({
  venues,
  heightClass = "h-64 md:h-72",
}: {
  venues: MappableVenue[];
  heightClass?: string;
}) {
  const pins = useMemo<MapPin<Pinned>[]>(() => {
    const out: MapPin<Pinned>[] = [];
    venues.forEach((v, i) => {
      if (!hasCoords(v)) return;
      out.push({
        key: `${v.name}-${i}`,
        lat: v.lat,
        lng: v.lng,
        title: v.name,
        background: VENUE_PIN_COLOR,
        glyph: String(i + 1), // list index — matches the numbered venue above
        data: v,
      });
    });
    return out;
  }, [venues]);

  if (pins.length < 2) return null;

  return (
    <MapView
      pins={pins}
      heightClass={heightClass}
      renderInfo={(v) => (
        <div className="max-w-[220px] space-y-1.5 p-0.5 text-ink">
          {v.photo_url && (
            <img src={v.photo_url} alt={v.name} className="h-24 w-full rounded-md object-cover" />
          )}
          <p className="text-sm font-semibold">{v.name}</p>
          <p className="text-xs text-ink-soft">
            {[v.category, v.city].filter(Boolean).join(" · ")}
          </p>
          {v.rating ? (
            <p className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
              <Star className="h-3 w-3 fill-favorite text-favorite" />
              {v.rating}
              {v.price_level ? ` · ${v.price_level}` : ""}
            </p>
          ) : null}
          <ActionRow actions={v.action_links} compact />
        </div>
      )}
    />
  );
}
