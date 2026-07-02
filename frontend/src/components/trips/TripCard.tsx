import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plane, Calendar, Star } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { TripItem } from "@/lib/types";

const TRIP_ACCENT = paletteAccent(8); // the "trip" palette, shared with itinerary notes

// Travel photos look good cropped, so (like recipes) the image is cover-filled at a landscape ratio.
function TripImage({ item }: { item: TripItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl ${TRIP_ACCENT.soft}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <Plane className={`h-1/4 w-1/4 opacity-50 ${TRIP_ACCENT.text}`} />
      </div>
      {item.image_url && !failed && (
        <img
          src={item.image_url}
          alt={item.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// One trip card. Tapping the image opens the trip-detail page; the ⭐ toggle writes through the
// backend (optimistic — handled by the parent).
export function TripCard({
  item,
  onToggleFavorite,
}: {
  item: TripItem;
  onToggleFavorite: (item: TripItem) => void;
}) {
  const favorite = !!item.favorite;

  return (
    <div className="group relative flex min-w-0 flex-col gap-2">
      <div className="relative">
        <Link to="/trips/$itemId" params={{ itemId: item.id }} className="block">
          <TripImage item={item} />
        </Link>
        <button
          type="button"
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          title={favorite ? "Favorite" : "Add to favorites"}
          onClick={() => onToggleFavorite(item)}
          className={`absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${FOCUS_RING} ${
            favorite
              ? "border-transparent bg-amber-400 text-white"
              : "border-border bg-background/80 text-ink-soft hover:text-ink"
          }`}
        >
          <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
        </button>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink" title={item.title}>
          {item.title}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
          {item.destination && <span className="truncate">{item.destination}</span>}
          {item.destination && item.duration && <span className="opacity-40">·</span>}
          {item.duration && (
            <span className="inline-flex items-center gap-0.5">
              <Calendar className="h-3 w-3" />
              {item.duration}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
