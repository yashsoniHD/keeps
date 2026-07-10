import { useMemo, useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import { MapIcon } from "lucide-react";
import type { TripDay } from "@/lib/types";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";

// A repeating palette so each day's stops read as a group on the map.
const DAY_COLORS = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626"];

// Shared fallback so a Maps load/auth failure (e.g. the browser key not yet authorized for the Maps
// JavaScript API) degrades to a notice instead of crashing the whole route.
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

interface PinnedStop {
  id: string;
  day: number;
  dayIndex: number;
  place: string;
  time?: string | null;
  note?: string | null;
  lat: number;
  lng: number;
}

// Flatten an itinerary's days into the geocoded stops only (those the worker resolved to
// coordinates during enrichment).
function pinnedStops(days: TripDay[]): PinnedStop[] {
  const out: PinnedStop[] = [];
  days.forEach((day, di) => {
    (day.stops ?? []).forEach((stop, si) => {
      if (typeof stop.lat === "number" && typeof stop.lng === "number") {
        out.push({
          id: `${di}-${si}`,
          day: day.day ?? di + 1,
          dayIndex: di,
          place: stop.place,
          time: stop.time,
          note: stop.note,
          lat: stop.lat,
          lng: stop.lng,
        });
      }
    });
  });
  return out;
}

// A live Google map of an itinerary note's stops, markers coloured by day. Stops without
// coordinates (unmatched places) are simply absent from the map — they still appear in the
// day-by-day timeline. Renders nothing when no browser Maps key is configured or no stop resolved.
export function TripMap({
  days,
  heightClass = "h-[45vh]",
}: {
  days: TripDay[];
  heightClass?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const pinned = useMemo(() => pinnedStops(days), [days]);

  const center = useMemo(() => {
    if (!pinned.length) return { lat: 19.076, lng: 72.8777 }; // Mumbai default
    const lat = pinned.reduce((s, i) => s + i.lat, 0) / pinned.length;
    const lng = pinned.reduce((s, i) => s + i.lng, 0) / pinned.length;
    return { lat, lng };
  }, [pinned]);

  if (!API_KEY || !pinned.length) return null; // no map to show — the timeline still renders below

  const open = pinned.find((i) => i.id === openId) ?? null;

  return (
    <ErrorBoundary
      label="trip-map"
      fallback={
        <MapNotice heightClass={heightClass}>
          <p className="text-sm font-medium text-ink">Map couldn’t load</p>
          <p className="max-w-xs text-xs text-ink-soft">
            The day-by-day plan still works. (If this persists, the Maps JavaScript API may not be
            enabled for this site’s key.)
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
            {pinned.map((i) => {
              const color = DAY_COLORS[i.dayIndex % DAY_COLORS.length];
              return (
                <AdvancedMarker
                  key={i.id}
                  position={{ lat: i.lat, lng: i.lng }}
                  title={i.place}
                  onClick={() => setOpenId(i.id)}
                >
                  <Pin background={color} borderColor={color} glyphColor="#ffffff" />
                </AdvancedMarker>
              );
            })}

            {open && (
              <InfoWindow
                position={{ lat: open.lat, lng: open.lng }}
                onCloseClick={() => setOpenId(null)}
                pixelOffset={[0, -36]}
              >
                <div className="max-w-[220px] space-y-1 p-0.5 text-ink">
                  <p className="text-xs font-medium text-ink-soft">
                    Day {open.day}
                    {open.time ? ` · ${open.time}` : ""}
                  </p>
                  <p className="text-sm font-semibold">{open.place}</p>
                  {open.note && <p className="text-xs text-ink-soft">{open.note}</p>}
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>
      </div>
    </ErrorBoundary>
  );
}
