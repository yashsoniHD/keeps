import { useMemo, useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import { Link } from "@tanstack/react-router";
import { MapIcon, Star } from "lucide-react";
import type { PlaceItem } from "@/lib/types";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ActionRow } from "./ActionRow";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";

// Shared fallback so a Maps load/auth failure (e.g. the browser key not yet authorized for the
// Maps JavaScript API) degrades to a notice instead of crashing the whole route.
function MapNotice({ heightClass, children }: { heightClass: string; children: React.ReactNode }) {
  return (
    <div
      className={`flex ${heightClass} flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card text-center`}
    >
      <MapIcon className="h-8 w-8 text-ink-soft/50" />
      {children}
    </div>
  );
}

// Marker colour by bucket so the wall reads at a glance.
const PIN: Record<PlaceItem["place_status"], { background: string; glyph: string }> = {
  saved: { background: "#9aa0a6", glyph: "#ffffff" },
  to_visit: { background: "#5b8c5a", glyph: "#ffffff" }, // itinerary sage
  visited: { background: "#2563eb", glyph: "#ffffff" },
};

type Pinned = PlaceItem & { lat: number; lng: number };

function hasCoords(i: PlaceItem): i is Pinned {
  return typeof i.lat === "number" && typeof i.lng === "number";
}

// A live Google map of the user's places, markers coloured by bucket. Items without coordinates
// (unmatched venues) are simply absent from the map — they still appear in Grid/List. Degrades to
// a notice when no browser Maps key is configured.
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
  const [openId, setOpenId] = useState<string | null>(null);
  const pinned = useMemo(() => items.filter(hasCoords), [items]);

  const center = useMemo(() => {
    if (!pinned.length) return { lat: 19.076, lng: 72.8777 }; // Mumbai default
    const lat = pinned.reduce((s, i) => s + i.lat, 0) / pinned.length;
    const lng = pinned.reduce((s, i) => s + i.lng, 0) / pinned.length;
    return { lat, lng };
  }, [pinned]);

  if (!API_KEY) {
    return (
      <MapNotice heightClass={heightClass}>
        <p className="text-sm font-medium text-ink">Map unavailable</p>
        <p className="max-w-xs text-xs text-ink-soft">
          Set <code>VITE_GOOGLE_MAPS_BROWSER_KEY</code> to show your places on a map. Grid and List
          views work without it.
        </p>
      </MapNotice>
    );
  }

  if (!pinned.length) {
    return (
      <MapNotice heightClass={heightClass}>
        <p className="text-sm text-ink-soft">No mapped places in this view yet.</p>
      </MapNotice>
    );
  }

  const open = pinned.find((i) => i.id === openId) ?? null;

  return (
    <ErrorBoundary
      label="places-map"
      fallback={
        <MapNotice heightClass={heightClass}>
          <p className="text-sm font-medium text-ink">Map couldn’t load</p>
          <p className="max-w-xs text-xs text-ink-soft">
            The list and grid views still work. (If this persists, the Maps JavaScript API may not
            be enabled for this site’s key.)
          </p>
        </MapNotice>
      }
    >
      <div className={`${heightClass} overflow-hidden rounded-2xl border border-border`}>
        <APIProvider apiKey={API_KEY}>
          <Map
            mapId={MAP_ID}
            defaultCenter={center}
            defaultZoom={pinned.length > 1 ? 11 : 14}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            {pinned.map((i) => (
              <AdvancedMarker
                key={i.id}
                position={{ lat: i.lat, lng: i.lng }}
                title={i.name}
                onClick={interactive ? () => setOpenId(i.id) : undefined}
              >
                <Pin
                  background={PIN[i.place_status].background}
                  borderColor={PIN[i.place_status].background}
                  glyphColor={PIN[i.place_status].glyph}
                />
              </AdvancedMarker>
            ))}

            {interactive && open && (
              <InfoWindow
                position={{ lat: open.lat, lng: open.lng }}
                onCloseClick={() => setOpenId(null)}
                pixelOffset={[0, -36]}
              >
                <div className="max-w-[220px] space-y-1.5 p-0.5 text-ink">
                  {open.photo_url && (
                    <img
                      src={open.photo_url}
                      alt={open.name}
                      className="h-24 w-full rounded-md object-cover"
                    />
                  )}
                  <Link
                    to="/places/$itemId"
                    params={{ itemId: open.id }}
                    className="block text-sm font-semibold hover:underline"
                  >
                    {open.name}
                  </Link>
                  <p className="text-xs text-ink-soft">
                    {[open.category, open.city].filter(Boolean).join(" · ")}
                  </p>
                  {open.rating ? (
                    <p className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {open.rating}
                      {open.price_level ? ` · ${open.price_level}` : ""}
                    </p>
                  ) : null}
                  <ActionRow actions={open.action_links} compact />
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>
      </div>
    </ErrorBoundary>
  );
}
