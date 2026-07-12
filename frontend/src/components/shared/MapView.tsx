import { useMemo, useState } from "react";
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from "@vis.gl/react-google-maps";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportMapsLoadError, useMapsLoadFailed } from "@/lib/maps";
import { MapFallback } from "./MapFallback";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const MAP_ID = (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined) || "DEMO_MAP_ID";

// One geocoded marker. `data` carries the wrapper's source object so `renderInfo` can build a
// rich InfoWindow without MapView knowing anything about venues / stops / places.
export interface MapPin<T = unknown> {
  key: string;
  lat: number;
  lng: number;
  title?: string;
  background: string;
  glyph?: string;
  data: T;
}

// The shared Google Maps shell for every map in the app (trip stops, place-note venues, the
// places wall): API provider, auto-centering, per-marker pins, a single open InfoWindow, and the
// load-failure fallback. Wrappers supply already-geocoded pins and an optional InfoWindow renderer.
export function MapView<T>({
  pins,
  heightClass,
  interactive = true,
  renderInfo,
}: {
  pins: MapPin<T>[];
  heightClass: string;
  // When false, markers are static — no click handler and no InfoWindow (the detail-page mini-map).
  interactive?: boolean;
  renderInfo?: (data: T, close: () => void) => React.ReactNode;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const loadFailed = useMapsLoadFailed();

  const center = useMemo(() => {
    if (!pins.length) return { lat: 19.076, lng: 72.8777 }; // Mumbai default
    const lat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
    const lng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
    return { lat, lng };
  }, [pins]);

  const fallback = <MapFallback heightClass={heightClass} />;

  // No key or an async auth failure (bad referrer, billing) → the notice, not a dead container.
  if (!API_KEY || loadFailed) return fallback;

  const open = pins.find((p) => p.key === openKey) ?? null;
  const canOpen = interactive && !!renderInfo;

  return (
    <ErrorBoundary label="map" fallback={fallback}>
      <div className={`${heightClass} overflow-hidden rounded-2xl border border-border`}>
        <APIProvider apiKey={API_KEY} onError={reportMapsLoadError}>
          <Map
            mapId={MAP_ID}
            defaultCenter={center}
            defaultZoom={pins.length > 1 ? 11 : 14}
            gestureHandling="greedy"
            disableDefaultUI={false}
          >
            {pins.map((p) => (
              <AdvancedMarker
                key={p.key}
                position={{ lat: p.lat, lng: p.lng }}
                title={p.title}
                onClick={canOpen ? () => setOpenKey(p.key) : undefined}
              >
                <Pin background={p.background} borderColor={p.background} glyphColor={p.glyph ?? "#ffffff"} />
              </AdvancedMarker>
            ))}

            {canOpen && open && (
              <InfoWindow
                position={{ lat: open.lat, lng: open.lng }}
                onCloseClick={() => setOpenKey(null)}
                pixelOffset={[0, -36]}
              >
                {renderInfo!(open.data, () => setOpenKey(null))}
              </InfoWindow>
            )}
          </Map>
        </APIProvider>
      </div>
    </ErrorBoundary>
  );
}
