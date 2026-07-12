import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChefHat, Clock, Star, Check } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { RecipeItem } from "@/lib/types";

const RECIPE_ACCENT = paletteAccent(0); // the "recipe" palette, shared with recipe notes

// The item's source site, for the favicon hint: the stored domain, falling back to the
// source URL's hostname (older items predate the `domain` field).
export function recipeDomain(item: RecipeItem): string | null {
  if (item.domain) return item.domain;
  if (!item.source_url) return null;
  try {
    return new URL(item.source_url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Food photos look good cropped, so (unlike products) the image is cover-filled at a landscape
// ratio rather than contained.
function RecipeImage({ item }: { item: RecipeItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl ${RECIPE_ACCENT.soft}`}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <ChefHat className={`h-1/4 w-1/4 opacity-50 ${RECIPE_ACCENT.text}`} />
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
      {/* Cook time worn on the photo like a cookbook margin note. */}
      {item.total_time && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full border border-border bg-card/90 px-2 py-0.5 text-[11px] font-medium text-ink shadow-sm backdrop-blur">
          <Clock className="h-3 w-3" />
          {item.total_time}
        </span>
      )}
    </div>
  );
}

// One recipe card. Tapping the image opens the recipe-detail page; in grocery mode the card becomes
// a selection toggle (for building a combined shopping list) instead of a link. The ⭐ toggle writes
// through the backend (optimistic — handled by the parent).
export const RecipeCard = memo(function RecipeCard({
  item,
  selecting,
  selected,
  onToggleSelect,
  onToggleFavorite,
}: {
  item: RecipeItem;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (item: RecipeItem) => void;
  onToggleFavorite: (item: RecipeItem) => void;
}) {
  const favorite = !!item.favorite;
  const domain = recipeDomain(item);

  return (
    <div className="group relative flex min-w-0 flex-col gap-2">
      <div className="relative">
        {selecting ? (
          <button
            type="button"
            onClick={() => onToggleSelect(item)}
            aria-pressed={selected}
            className={`block w-full rounded-xl ${FOCUS_RING} ${
              selected ? "ring-2 ring-recipe ring-offset-2 ring-offset-background" : ""
            }`}
          >
            <RecipeImage item={item} />
            <span
              className={`absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${
                selected
                  ? "border-transparent bg-recipe text-recipe-on"
                  : "border-border bg-background/80 text-ink-soft"
              }`}
            >
              {selected && <Check className="h-4 w-4" />}
            </span>
          </button>
        ) : (
          <>
            <Link
              to="/recipes/$itemId"
              params={{ itemId: item.id }}
              className={`press block rounded-xl shadow-sm transition-shadow hover:shadow-md ${FOCUS_RING}`}
            >
              <RecipeImage item={item} />
            </Link>
            <button
              type="button"
              aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
              title={favorite ? "Favorite" : "Add to favorites"}
              onClick={() => onToggleFavorite(item)}
              className={`absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${FOCUS_RING} ${
                favorite
                  ? "border-transparent bg-favorite text-favorite-on"
                  : "border-border bg-background/80 text-ink-soft hover:text-ink"
              }`}
            >
              <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
            </button>
          </>
        )}
      </div>

      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-ink">{item.title}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft">
          {/* Cuisine in the serif italic voice — a cookbook whisper (time moved onto the photo). */}
          {item.cuisine && (
            <span className="truncate font-serif italic text-recipe">{item.cuisine}</span>
          )}
          {item.difficulty && item.cuisine && <span className="opacity-40">·</span>}
          {item.difficulty && <span className="capitalize">{item.difficulty}</span>}
          {domain && (
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
              alt=""
              title={domain}
              loading="lazy"
              className="ml-auto h-3.5 w-3.5 shrink-0 rounded-sm opacity-70"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
});
