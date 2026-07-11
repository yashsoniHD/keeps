import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plane, Calendar, MapPin, Star, Sun, Wallet } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { TripItem } from "@/lib/types";

const TRIP_ACCENT = paletteAccent(8); // the "trip" palette, shared with itinerary notes

// A trip isn't a poster — it has a *shape* (how many days, how many stops, what season). So the
// card is a wide "journey card": photo on the left, destination in the serif voice, and the
// trip's shape as chips — visible before tapping in, unlike the old uniform 4:3 grid tile.
export const TripCard = memo(function TripCard({
  item,
  onToggleFavorite,
}: {
  item: TripItem;
  onToggleFavorite: (item: TripItem) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const favorite = !!item.favorite;

  const dayCount = item.days?.length ?? 0;
  const stopCount = (item.days ?? []).reduce((n, d) => n + (d.stops?.length ?? 0), 0);
  // Prefer the structured shape ("5 days · 12 stops"); fall back to the freeform duration.
  const shape =
    dayCount > 0
      ? `${dayCount} ${dayCount === 1 ? "day" : "days"}${stopCount > 0 ? ` · ${stopCount} stops` : ""}`
      : item.duration || null;

  return (
    <div className="group relative">
      <Link
        to="/trips/$itemId"
        params={{ itemId: item.id }}
        className={`press flex min-h-28 overflow-hidden rounded-2xl border border-trip/15 bg-card shadow-sm transition-shadow hover:shadow-md ${FOCUS_RING}`}
      >
        <div className={`relative w-28 shrink-0 self-stretch sm:w-40 ${TRIP_ACCENT.soft}`}>
          <div className="absolute inset-0 flex items-center justify-center">
            <Plane className={`h-8 w-8 opacity-50 ${TRIP_ACCENT.text}`} />
          </div>
          {item.image_url && !imgFailed && (
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setImgFailed(true)}
            />
          )}
        </div>
        <div className="min-w-0 flex-1 p-4 pr-11">
          <p
            className="truncate font-serif text-xl leading-tight text-ink sm:text-2xl"
            title={item.destination || item.title}
          >
            {item.destination || item.title}
          </p>
          {item.destination && item.title !== item.destination && (
            <p className="mt-0.5 truncate text-xs text-ink-soft">{item.title}</p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {shape && (
              <span className="inline-flex items-center gap-1 rounded-full bg-trip-soft px-2 py-0.5 text-[11px] font-medium text-trip">
                <Calendar className="h-3 w-3" />
                {shape}
              </span>
            )}
            {item.best_season && (
              <span className="inline-flex items-center gap-1 rounded-full bg-summary-soft px-2 py-0.5 text-[11px] font-medium text-summary">
                <Sun className="h-3 w-3" />
                {item.best_season}
              </span>
            )}
            {item.budget && (
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                <Wallet className="h-3 w-3" />
                {item.budget}
              </span>
            )}
            {!shape && !item.best_season && !item.budget && item.domain && (
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-soft">
                <MapPin className="h-3 w-3" />
                {item.domain}
              </span>
            )}
          </div>
        </div>
      </Link>
      <button
        type="button"
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        title={favorite ? "Favorite" : "Add to favorites"}
        onClick={() => onToggleFavorite(item)}
        className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${FOCUS_RING} ${
          favorite
            ? "border-transparent bg-favorite text-white"
            : "border-border bg-background/80 text-ink-soft hover:text-ink"
        }`}
      >
        <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
      </button>
    </div>
  );
});
