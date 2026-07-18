import { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";
import RNMapView, { Marker, Callout, type LatLng, type Region } from "react-native-maps";
import { useTheme } from "@/theme/ThemeProvider";

// The mobile counterpart of frontend/src/components/shared/MapView.tsx. The web version wraps
// @vis.gl/react-google-maps (AdvancedMarker + Pin glyphs + InfoWindows); here we wrap
// react-native-maps on the device's default map engine (Apple Maps on iOS — PROVIDER_GOOGLE is
// deliberately NOT set, so no Google Maps SDK key is needed). Wrappers hand us already-geocoded
// pins; MapView owns centering, auto-fit, the numbered marker glyph, and the tap callout.
//
// Props contract (what wrappers like VenuesMap / an itinerary TripMap pass):
//   pins: {
//     lat, lng            — required coordinates
//     label?  — short text drawn inside the marker circle (a venue's list number)
//     color?  — marker circle background as a hex string (defaults to place sage); the map
//               engine can't read CSS/NativeWind tokens, so callers pass literal hex
//     title?, subtitle?   — callout heading + secondary line, shown on marker tap
//   }[]
//   height? — fixed pixel height (defaults to 280, matching the web h-64/h-72 maps)
export interface MapPin {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  title?: string;
  subtitle?: string;
}

// Place-accent sage — mirrors frontend/src/lib/map-colors.ts VENUE_PIN_COLOR. Used when a caller
// doesn't tie a pin to its own colour.
const DEFAULT_PIN_COLOR = "#3c7b54";
const MUMBAI: LatLng = { latitude: 19.076, longitude: 72.8777 };

export function MapView({ pins, height = 280 }: { pins: MapPin[]; height?: number }) {
  const mapRef = useRef<RNMapView>(null);
  const { resolved } = useTheme();

  const coordinates = useMemo<LatLng[]>(
    () => pins.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [pins],
  );

  // Initial framing before the imperative fit lands: the centroid of the pins (Mumbai when empty),
  // zoomed out for a cluster, tight for a lone pin.
  const initialRegion = useMemo<Region>(() => {
    if (!pins.length) return { ...MUMBAI, latitudeDelta: 0.5, longitudeDelta: 0.5 };
    const latitude = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
    const longitude = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
    const delta = pins.length > 1 ? 0.2 : 0.02;
    return { latitude, longitude, latitudeDelta: delta, longitudeDelta: delta };
  }, [pins]);

  // Frame every pin with padding. Only meaningful for 2+ coordinates (a single pin keeps its tight
  // initialRegion). Re-run when the pin set changes.
  const fit = () => {
    if (coordinates.length > 1) {
      mapRef.current?.fitToCoordinates(coordinates, {
        edgePadding: { top: 48, right: 48, bottom: 48, left: 48 },
        animated: false,
      });
    }
  };

  useEffect(fit, [coordinates]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pins.length) return null;

  return (
    <View className="overflow-hidden rounded-2xl border border-border" style={{ height }}>
      <RNMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        // Apple Maps on iOS honours the OS-resolved light/dark scheme so the map matches the note.
        userInterfaceStyle={resolved}
        initialRegion={initialRegion}
        onMapReady={fit}
      >
        {pins.map((p, i) => {
          const canCallout = Boolean(p.title || p.subtitle);
          return (
            <Marker
              key={`${p.lat},${p.lng}-${i}`}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              {/* Custom glyph so a pin's number matches the venue list order — the web Pin glyph. */}
              <View
                style={[styles.pin, { backgroundColor: p.color ?? DEFAULT_PIN_COLOR }]}
              >
                {p.label ? <Text style={styles.pinText}>{p.label}</Text> : null}
              </View>
              {canCallout && (
                <Callout>
                  <View style={styles.callout}>
                    {p.title ? <Text style={styles.calloutTitle}>{p.title}</Text> : null}
                    {p.subtitle ? <Text style={styles.calloutSubtitle}>{p.subtitle}</Text> : null}
                  </View>
                </Callout>
              )}
            </Marker>
          );
        })}
      </RNMapView>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    height: 26,
    minWidth: 26,
    paddingHorizontal: 4,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  pinText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  // Callout renders in a native bubble; NativeWind classes don't reliably reach it, so it's styled
  // with plain (theme-agnostic) values and constrained width.
  callout: {
    maxWidth: 220,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#190f0a",
  },
  calloutSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: "#5e534a",
  },
});
