import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import type { PlaceItem } from "@/lib/types";
import { PLACE_STATUS_PIN } from "@/lib/map-colors";
import { MapView, type MapPin } from "@/components/shared/MapView";
import { MapFallback } from "@/components/shared/MapFallback";
import { ActionRow } from "@/components/shared/ActionRow";

type Pinned = PlaceItem & { lat: number; lng: number };

function hasCoords(i: PlaceItem): i is Pinned {
  return typeof i.lat === "number" && typeof i.lng === "number";
}

// A live Google map of the user's places, markers coloured by bucket. Items without coordinates
// (unmatched venues) are absent from the map — they still appear in Grid/List. Shows the shared
// fallback when nothing is mapped, no browser Maps key is configured, or the API fails to load.
export function PlacesMap({
  items,
  heightClass = "h-[60vh]",
  interactive = true,
}: {
  items: PlaceItem[];
  heightClass?: string;
  // When false (the detail-page mini-map), markers are static — no click handler and no InfoWindow,
  // so a single pin just shows where the place is without the interactive crash surface.
  interactive?: boolean;
}) {
  const pins = useMemo<MapPin<Pinned>[]>(
    () =>
      items.filter(hasCoords).map((i) => ({
        key: i.id,
        lat: i.lat,
        lng: i.lng,
        title: i.name,
        background: PLACE_STATUS_PIN[i.place_status].background,
        glyphColor: PLACE_STATUS_PIN[i.place_status].glyph,
        data: i,
      })),
    [items],
  );

  if (!pins.length) {
    return <MapFallback heightClass={heightClass} message="No mapped places in this view yet." />;
  }

  return (
    <MapView
      pins={pins}
      heightClass={heightClass}
      interactive={interactive}
      renderInfo={(i) => (
        <div className="max-w-[220px] space-y-1.5 p-0.5 text-ink">
          {i.photo_url && (
            <img src={i.photo_url} alt={i.name} className="h-24 w-full rounded-md object-cover" />
          )}
          <Link
            to="/places/$itemId"
            params={{ itemId: i.id }}
            className="block text-sm font-semibold hover:underline"
          >
            {i.name}
          </Link>
          <p className="text-xs text-ink-soft">
            {[i.category, i.city].filter(Boolean).join(" · ")}
          </p>
          {i.rating ? (
            <p className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
              <Star className="h-3 w-3 fill-favorite text-favorite" />
              {i.rating}
              {i.price_level ? ` · ${i.price_level}` : ""}
            </p>
          ) : null}
          <ActionRow actions={i.action_links} compact />
        </div>
      )}
    />
  );
}
