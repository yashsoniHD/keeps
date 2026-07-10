import { useMemo, useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import { MapIcon, Star } from "lucide-react";
import type { PlaceAction } from "@/lib/types";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ActionRow } from "./ActionRow";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";

const PIN_COLOR = "#5b8c5a"; // place sage

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

// Shared fallback so a Maps load/auth failure degrades to a notice instead of crashing the note.
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

// A live Google map of a place note's venues. Renders nothing when no browser Maps key is
// configured or no venue resolved to coordinates — the venue list below always renders.
export function VenuesMap({
  venues,
  heightClass = "h-[40vh]",
}: {
  venues: MappableVenue[];
  heightClass?: string;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const pinned = useMemo(() => venues.filter(hasCoords), [venues]);

  const center = useMemo(() => {
    if (!pinned.length) return { lat: 19.076, lng: 72.8777 }; // Mumbai default
    const lat = pinned.reduce((s, v) => s + v.lat, 0) / pinned.length;
    const lng = pinned.reduce((s, v) => s + v.lng, 0) / pinned.length;
    return { lat, lng };
  }, [pinned]);

  if (!API_KEY || !pinned.length) return null;

  const open = openIdx !== null ? (pinned[openIdx] ?? null) : null;

  return (
    <ErrorBoundary
      label="venues-map"
      fallback={
        <MapNotice heightClass={heightClass}>
          <p className="text-sm font-medium text-ink">Map couldn’t load</p>
          <p className="max-w-xs text-xs text-ink-soft">
            The venue details below still work. (If this persists, the Maps JavaScript API may not
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
            {pinned.map((v, i) => (
              <AdvancedMarker
                key={`${v.name}-${i}`}
                position={{ lat: v.lat, lng: v.lng }}
                title={v.name}
                onClick={() => setOpenIdx(i)}
              >
                <Pin background={PIN_COLOR} borderColor={PIN_COLOR} glyphColor="#ffffff" />
              </AdvancedMarker>
            ))}

            {open && (
              <InfoWindow
                position={{ lat: open.lat, lng: open.lng }}
                onCloseClick={() => setOpenIdx(null)}
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
                  <p className="text-sm font-semibold">{open.name}</p>
                  <p className="text-xs text-ink-soft">
                    {[open.category, open.city].filter(Boolean).join(" · ")}
                  </p>
                  {open.rating ? (
                    <p className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
                      <Star className="h-3 w-3 fill-favorite text-favorite" />
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
