import { useEffect, useMemo, useState } from "react";
import { Clapperboard, ChevronDown } from "lucide-react";
import { watchWatchItems } from "@/lib/firestore";
import { updateWatchItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import type { WatchItem } from "@/lib/types";
import { WatchCard } from "./WatchCard";

type MediaFilter = "all" | "movie" | "tv";
type SortKey = "added" | "year" | "rating";

const SELECT_CLS = `rounded-full border border-border bg-card px-3 py-1.5 text-xs text-ink ${FOCUS_RING}`;

function Grid({
  items,
  onToggleWatched,
  onRate,
}: {
  items: WatchItem[];
  onToggleWatched: (i: WatchItem) => void;
  onRate: (i: WatchItem, r: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((i) => (
        <WatchCard key={i.id} item={i} onToggleWatched={onToggleWatched} onRate={onRate} />
      ))}
    </div>
  );
}

// The Watchlist mini-app body: a live poster wall split into To Watch / Watched, with
// media-type / provider filters and sort. Owns the watch_items listener and applies
// optimistic state so toggling watched / rating feels instant.
export function WatchlistView({ uid }: { uid: string }) {
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [provider, setProvider] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [watchedOpen, setWatchedOpen] = useState(true);

  useEffect(() => {
    return watchWatchItems(uid, setItems);
  }, [uid]);

  // The set of streaming services seen across the user's titles (flatrate), for the filter.
  const providerNames = useMemo(() => {
    const s = new Set<string>();
    for (const i of items ?? [])
      for (const p of i.providers ?? []) if (p.type === "flatrate") s.add(p.name);
    return [...s].sort();
  }, [items]);

  const patchLocal = (id: string, patch: Partial<WatchItem>) =>
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i)) ?? prev);

  const onToggleWatched = async (item: WatchItem) => {
    const next = item.watch_status === "watched" ? "to_watch" : "watched";
    patchLocal(item.id, { watch_status: next });
    try {
      await updateWatchItem(item.id, { watch_status: next });
    } catch {
      patchLocal(item.id, { watch_status: item.watch_status }); // revert on failure
    }
  };

  const onRate = async (item: WatchItem, rating: number) => {
    const prev = item.rating ?? null;
    patchLocal(item.id, { rating });
    try {
      await updateWatchItem(item.id, { rating });
    } catch {
      patchLocal(item.id, { rating: prev });
    }
  };

  const filterSort = (list: WatchItem[]) => {
    let out = list;
    if (media !== "all") out = out.filter((i) => i.media_type === media);
    if (provider !== "all")
      out = out.filter((i) => (i.providers ?? []).some((p) => p.name === provider));
    const sorted = [...out];
    if (sort === "year")
      sorted.sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
    else if (sort === "rating")
      sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    // "added" keeps the listener's created_at-desc order.
    return sorted;
  };

  if (items === null) {
    return (
      <div className="flex justify-center py-20">
        <Clapperboard className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <Clapperboard className="mx-auto h-10 w-10 text-ink-soft/50" />
        <p className="mt-4 font-medium text-ink">Save a movie or show and it lands here</p>
        <p className="mt-1 text-sm text-ink-soft">
          Share a reel, a listicle, or a single title — each film and series becomes its own
          card with a poster and where to watch it.
        </p>
      </div>
    );
  }

  const toWatch = filterSort(items.filter((i) => i.watch_status !== "watched"));
  const watched = filterSort(items.filter((i) => i.watch_status === "watched"));

  return (
    <div className="space-y-8">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select className={SELECT_CLS} value={media} onChange={(e) => setMedia(e.target.value as MediaFilter)}>
          <option value="all">All types</option>
          <option value="movie">Films</option>
          <option value="tv">TV</option>
        </select>
        {providerNames.length > 0 && (
          <select className={SELECT_CLS} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="all">Any service</option>
            {providerNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <select className={SELECT_CLS} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="added">Recently added</option>
          <option value="year">Year</option>
          <option value="rating">Rating</option>
        </select>
      </div>

      {toWatch.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">To watch · {toWatch.length}</h2>
          <Grid items={toWatch} onToggleWatched={onToggleWatched} onRate={onRate} />
        </section>
      )}

      {watched.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setWatchedOpen((o) => !o)}
            className={`mb-3 flex items-center gap-1 text-sm font-semibold text-ink-soft ${FOCUS_RING} rounded`}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${watchedOpen ? "" : "-rotate-90"}`} />
            Watched · {watched.length}
          </button>
          {watchedOpen && <Grid items={watched} onToggleWatched={onToggleWatched} onRate={onRate} />}
        </section>
      )}
    </div>
  );
}
