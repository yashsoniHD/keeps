import { useMemo } from "react";
import type { TripDay } from "@/lib/types";
import { DAY_COLORS } from "@/lib/map-colors";
import { MapView, type MapPin } from "./MapView";

interface PinnedStop {
  day: number;
  place: string;
  time?: string | null;
  note?: string | null;
}

// Flatten an itinerary's days into the geocoded stops only (those the worker resolved to
// coordinates during enrichment), coloured by day.
function pins(days: TripDay[]): MapPin<PinnedStop>[] {
  const out: MapPin<PinnedStop>[] = [];
  days.forEach((day, di) => {
    (day.stops ?? []).forEach((stop, si) => {
      if (typeof stop.lat === "number" && typeof stop.lng === "number") {
        const color = DAY_COLORS[di % DAY_COLORS.length];
        out.push({
          key: `${di}-${si}`,
          lat: stop.lat,
          lng: stop.lng,
          title: stop.place,
          background: color,
          data: { day: day.day ?? di + 1, place: stop.place, time: stop.time, note: stop.note },
        });
      }
    });
  });
  return out;
}

// A live Google map of an itinerary / trip's stops, markers coloured by day. Stops without
// coordinates (unmatched places) are simply absent — they still appear in the day-by-day timeline,
// so this renders nothing when no stop resolved to coordinates.
export function TripMap({ days, heightClass = "h-[45vh]" }: { days: TripDay[]; heightClass?: string }) {
  const pinned = useMemo(() => pins(days), [days]);
  if (!pinned.length) return null;

  return (
    <MapView
      pins={pinned}
      heightClass={heightClass}
      renderInfo={(s) => (
        <div className="max-w-[220px] space-y-1 p-0.5 text-ink">
          <p className="text-xs font-medium text-ink-soft">
            Day {s.day}
            {s.time ? ` · ${s.time}` : ""}
          </p>
          <p className="text-sm font-semibold">{s.place}</p>
          {s.note && <p className="text-xs text-ink-soft">{s.note}</p>}
        </div>
      )}
    />
  );
}
