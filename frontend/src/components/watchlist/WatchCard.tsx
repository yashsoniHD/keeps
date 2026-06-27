import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clapperboard, Tv, Eye, CheckCircle2, Star } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { WatchItem } from "@/lib/types";

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

// One poster card. Tapping the poster opens the note it came from; the watched toggle and
// star rating sit on top and write through the backend (optimistic — handled by the parent).
export function WatchCard({
  item,
  onToggleWatched,
  onRate,
}: {
  item: WatchItem;
  onToggleWatched: (item: WatchItem) => void;
  onRate: (item: WatchItem, rating: number) => void;
}) {
  const watched = item.watch_status === "watched";
  const noteId = item.source_note_ids?.[0];
  const flatrate = (item.providers ?? []).filter((p) => p.type === "flatrate");

  const poster = noteId ? (
    <Link to="/notes/$noteId" params={{ noteId }} className="block">
      <PosterImage item={item} />
    </Link>
  ) : (
    <PosterImage item={item} />
  );

  return (
    <div className="group relative flex min-w-0 flex-col gap-2">
      <div className="relative">
        {poster}
        {/* Watched toggle overlay */}
        <button
          type="button"
          aria-label={watched ? "Mark as to watch" : "Mark as watched"}
          title={watched ? "Watched" : "Mark watched"}
          onClick={() => onToggleWatched(item)}
          className={`absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${FOCUS_RING} ${
            watched
              ? "border-transparent bg-media text-white"
              : "border-border bg-background/80 text-ink-soft hover:text-ink"
          }`}
        >
          {watched ? <CheckCircle2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        {/* Media-type chip */}
        <span className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${MEDIA_ACCENT.chip}`}>
          {item.media_type === "tv" ? "TV" : item.media_type === "movie" ? "Film" : "—"}
        </span>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink" title={item.title}>
          {item.title}
        </p>
        {item.year && <p className="text-xs text-ink-soft">{item.year}</p>}
      </div>

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

      {/* Rating — only on watched items */}
      {watched && (
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Rate ${n} of 5`}
              onClick={() => onRate(item, n)}
              className={`${FOCUS_RING} rounded p-0.5`}
            >
              <Star
                className={`h-3.5 w-3.5 ${
                  (item.rating ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-ink-soft/40"
                }`}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
