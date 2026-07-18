import { useMemo } from "react";
import type { TripDay } from "@clipnote/shared";
import { MapView, type MapPin } from "./MapView";

// Google-map marker colours per day, so each day's stops read as a group. Ported inline from
// frontend/src/lib/map-colors.ts DAY_COLORS — the map engine can't read NativeWind tokens, so pins
// take literal hex strings.
const DAY_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
];

// A live map of an itinerary's stops, pins coloured by day. Only stops the backend geocoded
// (lat/lng filled in during enrichment) appear; unresolved stops still show in the day-by-day
// timeline. Pins are numbered by OVERALL stop order across the whole trip — a running counter over
// every stop, so a non-geocoded stop still consumes a number and the visible pin labels line up
// with reading order (mirrors VenuesMap's "position in the full list" numbering, applied globally
// across days). Renders nothing when no stop resolved to coordinates: the same gate as web's
// TripMap, which draws even a single geocoded stop (the shared MapView plots one pin and skips the
// 2+ auto-fit).
export function TripMap({ days, height = 280 }: { days: TripDay[]; height?: number }) {
  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    let order = 0;
    days.forEach((day, di) => {
      (day.stops ?? []).forEach((stop) => {
        order += 1;
        if (typeof stop.lat !== "number" || typeof stop.lng !== "number") return;
        const dayLabel = day.title ? `Day ${day.day} · ${day.title}` : `Day ${day.day}`;
        out.push({
          lat: stop.lat,
          lng: stop.lng,
          label: String(order), // overall stop order — the map pin's number
          color: DAY_COLORS[di % DAY_COLORS.length],
          title: stop.place,
          subtitle: dayLabel,
        });
      });
    });
    return out;
  }, [days]);

  if (!pins.length) return null;
  return <MapView pins={pins} height={height} />;
}
