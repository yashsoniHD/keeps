import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clapperboard, Tv, Eye, CheckCircle2, Star, Plus } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { WatchItem } from "@/lib/types";
// Rating is edited on the detail page; cards show it read-only (a compact star + number) so the
// poster wall stays uncluttered.

const MEDIA_ACCENT = paletteAccent(4); // the "media" palette, shared with entertainment notes

function PosterImage({ item }: { item: WatchItem }) {
  const [failed, setFailed] = useState(false);
  const Icon = item.media_type === "tv" ? Tv : Clapperboard;
  return (
    <div className={`relative aspect-[2/3] w-full overflow-hidden rounded-xl ${MEDIA_ACCENT.soft}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon className={`h-1/4 w-1/4 opacity-60 ${MEDIA_ACCENT.text}`} />
      </div>
      {item.poster_url && !failed && (
        <img
          src={item.poster_url}
          alt={item.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// One poster card. Tapping the poster opens the movie-detail page; the watched toggle and the
// "+ Watchlist" promote action (Saved items only) write through the backend (optimistic — handled
// by the parent). Rating is set on the detail page and shown here read-only.
export function WatchCard({
  item,
  onToggleWatched,
  onAddToWatchlist,
  onToggleFavorite,
}: {
  item: WatchItem;
  onToggleWatched: (item: WatchItem) => void;
  onAddToWatchlist: (item: WatchItem) => void;
  onToggleFavorite: (item: WatchItem) => void;
}) {
  const watched = item.watch_status === "watched";
  const saved = item.watch_status === "saved";
  const favorite = !!item.favorite;
  const flatrate = (item.providers ?? []).filter((p) => p.type === "flatrate");

  const poster = (
    <Link to="/watchlist/$itemId" params={{ itemId: item.id }} className="block">
      <PosterImage item={item} />
    </Link>
  );

  return (
    <div className="group relative flex min-w-0 flex-col gap-2">
      <div className="relative">
        {poster}
        {/* Overlay actions (top-right): watched toggle + favorite star */}
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1.5">
          <button
            type="button"
            aria-label={watched ? "Mark as to watch" : "Mark as watched"}
            title={watched ? "Watched" : "Mark watched"}
            onClick={() => onToggleWatched(item)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${FOCUS_RING} ${
              watched
                ? "border-transparent bg-media text-white"
                : "border-border bg-background/80 text-ink-soft hover:text-ink"
            }`}
          >
            {watched ? <CheckCircle2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            title={favorite ? "Favorite" : "Add to favorites"}
            onClick={() => onToggleFavorite(item)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${FOCUS_RING} ${
              favorite
                ? "border-transparent bg-amber-400 text-white"
                : "border-border bg-background/80 text-ink-soft hover:text-ink"
            }`}
          >
            <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
          </button>
        </div>
        {/* Media-type chip */}
        <span
          className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${MEDIA_ACCENT.chip}`}
        >
          {item.media_type === "tv" ? "TV" : item.media_type === "movie" ? "Film" : "—"}
        </span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink" title={item.title}>
          {item.title}
        </p>
        {/* Year + where it was saved from, on one quiet line */}
        {(item.year || item.source_domain) && (
          <p className="truncate text-xs text-ink-soft">
            {[item.year, item.source_domain].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>

      {/* Promote a Saved (inbox) item onto the watchlist */}
      {saved && (
        <button
          type="button"
          onClick={() => onAddToWatchlist(item)}
          className={`inline-flex w-full items-center justify-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-media-soft ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Watchlist
        </button>
      )}

      {/* Where to watch (flatrate first) */}
      {flatrate.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {flatrate.slice(0, 4).map((p) =>
            p.logo_url ? (
              <img
                key={p.name}
                src={p.logo_url}
                alt={p.name}
                title={p.name}
                loading="lazy"
                className="h-5 w-5 rounded"
              />
            ) : (
              <span key={p.name} className="rounded bg-card px-1 text-[10px] text-ink-soft">
                {p.name}
              </span>
            ),
          )}
        </div>
      )}

      {/* Rating — read-only badge on watched items the user has rated */}
      {watched && item.rating ? (
        <div className="flex items-center gap-1 text-xs text-ink-soft">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span>{item.rating}/5</span>
        </div>
      ) : null}
    </div>
  );
}
