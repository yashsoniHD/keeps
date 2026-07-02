import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MapPin, Star } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { PlaceItem } from "@/lib/types";

const PLACE_ACCENT = paletteAccent(1); // the "itinerary" palette (sage), shared with place notes

// A venue photo on a soft panel, gradient + pin fallback when there's no Google photo (e.g. a list
// note's venues share one cover, or an unmatched venue).
function PlaceImage({ item }: { item: PlaceItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl ${PLACE_ACCENT.soft}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <MapPin className={`h-1/4 w-1/4 opacity-50 ${PLACE_ACCENT.text}`} />
      </div>
      {item.photo_url && !failed && (
        <img
          src={item.photo_url}
          alt={item.name}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// "Been 3×" when you've logged more than one visit — a quiet text adornment, never a button.
function visitsLabel(item: PlaceItem): string | null {
  if (item.place_status !== "visited") return null;
  const n = item.visit_count ?? 0;
  return n > 1 ? `Been ${n}×` : "Been";
}

// Lean venue card — tap to open the detail page, where all actions (star / Been / directions /
// rate / note) live. The card itself is intentionally minimal: photo, name, category + city,
// rating, and a small star + Been-count adornment. No inline buttons.
export const PlaceCard = memo(function PlaceCard({ item }: { item: PlaceItem }) {
  const subtitle = [item.category, item.city].filter(Boolean).join(" · ");
  const visits = visitsLabel(item);

  return (
    <Link
      to="/places/$itemId"
      params={{ itemId: item.id }}
      className={`press group flex min-w-0 flex-col gap-2 rounded-xl ${FOCUS_RING}`}
    >
      <div className="relative rounded-xl shadow-sm transition-shadow group-hover:shadow-md">
        <PlaceImage item={item} />
        {item.favorite && (
          <span
            aria-label="Starred"
            className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-favorite text-white shadow-sm"
          >
            <Star className="h-3.5 w-3.5 fill-current" />
          </span>
        )}
        {visits && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-place px-2 py-0.5 text-[10px] font-medium text-white">
            {visits}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink" title={item.name}>
          {item.name}
        </p>
        {subtitle && <p className="truncate text-xs text-ink-soft">{subtitle}</p>}
      </div>

      {/* Your rating once Been, else Google rating + price level */}
      <div className="flex items-center justify-between gap-2">
        {item.place_status === "visited" && item.user_rating ? (
          <span className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
            <Star className="h-3.5 w-3.5 fill-favorite text-favorite" />
            {item.user_rating}/5 · you
          </span>
        ) : item.rating ? (
          <span className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
            <Star className="h-3.5 w-3.5 fill-favorite text-favorite" />
            {item.rating}
          </span>
        ) : (
          <span className="text-xs text-ink-soft">{item.price_for_two || " "}</span>
        )}
        {item.price_level && <span className="text-xs text-ink-soft">{item.price_level}</span>}
      </div>
    </Link>
  );
});

// Lean list row — the compact counterpart of PlaceCard, same tap-to-open, no inline action row.
export const PlaceRow = memo(function PlaceRow({ item }: { item: PlaceItem }) {
  const visits = visitsLabel(item);
  return (
    <Link
      to="/places/$itemId"
      params={{ itemId: item.id }}
      className={`flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-place-soft ${FOCUS_RING}`}
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-place-soft">
        {item.photo_url ? (
          <img
            src={item.photo_url}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <MapPin className="h-5 w-5 text-place/50" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-ink">{item.name}</p>
          {item.favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-favorite text-favorite" />}
        </div>
        <p className="truncate text-xs text-ink-soft">
          {[item.category, item.city].filter(Boolean).join(" · ")}
        </p>
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          {item.rating ? (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-favorite text-favorite" />
              {item.rating}
              {item.price_level ? ` · ${item.price_level}` : ""}
            </span>
          ) : null}
          {visits && <span className="text-place">{visits}</span>}
        </div>
      </div>
    </Link>
  );
});
