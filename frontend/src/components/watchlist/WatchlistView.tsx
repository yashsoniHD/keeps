import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { ArrowDownUp, Clapperboard, Film, Plus, Search, Star, Tv } from "lucide-react";
import { watchWatchItems } from "@/lib/firestore";
import { updateWatchItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import type { WatchItem } from "@/lib/types";
import {
  IconSelect,
  LoadMoreButton,
  WALL_GRID,
  WallError,
  WallSkeleton,
  useWallItems,
} from "@/components/mini-apps/wall";
import { WatchCard } from "./WatchCard";
import { AddTitleSheet } from "./AddTitleSheet";

type MediaFilter = "all" | "movie" | "tv";
type SortKey = "added" | "year" | "rating";
type Queue = "saved" | "to_watch" | "watched";

// Full literals so the Tailwind JIT sees them (see mini-apps/wall.tsx).
const ACCENT_ACTIVE = "bg-media text-white";

// Which tab an item belongs to. The retired in-progress "watching" status may still exist on
// older docs — display-only mapping onto the watchlist bucket (no migration writes).
const bucketOf = (i: WatchItem): Queue =>
  i.watch_status === "watching" ? "to_watch" : i.watch_status;

// Status priority for collapsing duplicates: keep the most-progressed copy.
const STATUS_RANK: Record<WatchItem["watch_status"], number> = {
  watched: 3,
  watching: 2,
  to_watch: 1,
  saved: 0,
};

const normTitle = (i: WatchItem) => (i.title ?? "").toLowerCase().trim().replace(/\s+/g, " ");

// Collapse the same title appearing across multiple notes into one card. Three sources of dupes:
//  1. the same TMDB-matched title across notes  → keyed by tmdb id;
//  2. an identical raw (unmatched) title         → keyed by normalized title;
//  3. a stale raw copy left over from before TMDB matching worked, now duplicated by an enriched
//     matched copy → the raw one is dropped in favour of the matched twin (same title).
// When a title survives in more than one bucket, keep the most-progressed copy (watched >
// to_watch > saved) so user state is never hidden, preserving the first-seen position.
function dedupeItems(list: WatchItem[]): WatchItem[] {
  const matchedTitles = new Set<string>();
  for (const i of list) if (i.tmdb_id) matchedTitles.add(normTitle(i));

  const best = new Map<string, WatchItem>();
  const fav = new Map<string, boolean>();
  for (const i of list) {
    // Drop a raw copy whose title also exists as an enriched (TMDB-matched) item.
    if (!i.tmdb_id && matchedTitles.has(normTitle(i))) continue;
    const k = i.tmdb_id ? `tmdb:${i.media_type}:${i.tmdb_id}` : `raw:${normTitle(i)}`;
    fav.set(k, (fav.get(k) ?? false) || !!i.favorite); // OR favorite across copies, never lose a ⭐
    const cur = best.get(k);
    if (!cur || STATUS_RANK[i.watch_status] > STATUS_RANK[cur.watch_status]) best.set(k, i);
  }
  return [...best.entries()].map(([k, i]) => ({ ...i, favorite: fav.get(k) || i.favorite }));
}

// Per-bucket empty-state copy.
const EMPTY: Record<Queue, { title: string; body: string }> = {
  saved: {
    title: "Save a movie or show and it lands here",
    body: "Share a reel or a listicle, or add a title directly — each film and series becomes its own card. Tap “+ Watchlist” to move the ones you actually want to watch.",
  },
  to_watch: {
    title: "Your watchlist is empty",
    body: "Add titles from Saved with “+ Watchlist”, or add one directly — this is your hand-picked queue of what to watch next.",
  },
  watched: {
    title: "Nothing watched yet",
    body: "Mark a title watched and it moves here, where you can rate it.",
  },
};

function Grid({
  items,
  onToggleWatched,
  onAddToWatchlist,
  onToggleFavorite,
}: {
  items: WatchItem[];
  onToggleWatched: (i: WatchItem) => void;
  onAddToWatchlist: (i: WatchItem) => void;
  onToggleFavorite: (i: WatchItem) => void;
}) {
  return (
    <div className={WALL_GRID}>
      {items.map((i) => (
        <WatchCard
          key={i.id}
          item={i}
          onToggleWatched={onToggleWatched}
          onAddToWatchlist={onAddToWatchlist}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}

// The Watchlist mini-app body: a live poster wall split into three mutually-exclusive buckets —
// Saved (auto-captured from notes, the inbox) → Watchlist (explicitly added) → Watched — with
// media-type / provider filters and sort. Owns the watch_items listener and applies optimistic
// state so promoting / toggling watched / rating feels instant.
export function WatchlistView({ uid }: { uid: string }) {
  const { items, setItems, error, retry, canLoadMore, loadMore } = useWallItems<WatchItem>(
    uid,
    watchWatchItems,
  );
  const [queue, setQueue] = useState<Queue>("saved");
  const [query, setQuery] = useState("");
  // Deferred so a keystroke doesn't synchronously re-filter and re-render the whole wall.
  const deferredQuery = useDeferredValue(query);
  const [media, setMedia] = useState<MediaFilter>("all");
  const [provider, setProvider] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [favOnly, setFavOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  // Collapse the same title saved across multiple notes into a single card.
  const deduped = useMemo(() => dedupeItems(items ?? []), [items]);

  // The set of streaming services seen across the user's titles (flatrate), for the filter.
  const providerNames = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped)
      for (const p of i.providers ?? []) if (p.type === "flatrate") s.add(p.name);
    return [...s].sort();
  }, [deduped]);

  // Stable identities (useCallback) so the memoized WatchCards skip re-rendering when
  // unrelated state (search text, filters) changes.
  const patchLocal = useCallback(
    (id: string, patch: Partial<WatchItem>) =>
      setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i)) ?? prev),
    [setItems],
  );

  const onToggleWatched = useCallback(
    async (item: WatchItem) => {
      const next = item.watch_status === "watched" ? "to_watch" : "watched";
      patchLocal(item.id, { watch_status: next });
      try {
        await updateWatchItem(item.id, { watch_status: next });
      } catch {
        patchLocal(item.id, { watch_status: item.watch_status }); // revert on failure
      }
    },
    [patchLocal],
  );

  // Promote a Saved (inbox) item onto the watchlist.
  const onAddToWatchlist = useCallback(
    async (item: WatchItem) => {
      patchLocal(item.id, { watch_status: "to_watch" });
      try {
        await updateWatchItem(item.id, { watch_status: "to_watch" });
      } catch {
        patchLocal(item.id, { watch_status: item.watch_status }); // revert on failure
      }
    },
    [patchLocal],
  );

  // Cross-cutting ⭐ flag — independent of the bucket the title sits in.
  const onToggleFavorite = useCallback(
    async (item: WatchItem) => {
      const next = !item.favorite;
      patchLocal(item.id, { favorite: next });
      try {
        await updateWatchItem(item.id, { favorite: next });
      } catch {
        patchLocal(item.id, { favorite: item.favorite }); // revert on failure
      }
    },
    [patchLocal],
  );

  // Rating only exists on watched items, so the "rating" sort is only meaningful on that tab;
  // elsewhere it falls back to "added" so it's never a silent no-op.
  const effectiveSort: SortKey = sort === "rating" && queue !== "watched" ? "added" : sort;

  const filterSort = (list: WatchItem[]) => {
    let out = list;
    const q = deferredQuery.trim().toLowerCase();
    if (q) out = out.filter((i) => (i.title ?? "").toLowerCase().includes(q));
    if (media !== "all") out = out.filter((i) => i.media_type === media);
    if (provider !== "all")
      out = out.filter((i) => (i.providers ?? []).some((p) => p.name === provider));
    const sorted = [...out];
    if (effectiveSort === "year") sorted.sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
    else if (effectiveSort === "rating") sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    // "added" keeps the listener's created_at-desc order.
    return sorted;
  };

  if (error && items === null) return <WallError onRetry={retry} />;
  if (items === null) return <WallSkeleton aspect="aspect-[2/3]" />;

  // Buckets are mutually exclusive: each item is in exactly one of Saved / Watchlist / Watched
  // (legacy "watching" docs count as Watchlist via bucketOf). Counts and filtering run on the
  // deduped list so a title saved in several notes is counted once. Favorites is a cross-cutting
  // view: when active it shows ⭐ titles across all buckets.
  const counts = {
    saved: deduped.filter((i) => bucketOf(i) === "saved").length,
    to_watch: deduped.filter((i) => bucketOf(i) === "to_watch").length,
    watched: deduped.filter((i) => bucketOf(i) === "watched").length,
  };
  const favCount = deduped.filter((i) => i.favorite).length;
  const base = favOnly
    ? deduped.filter((i) => i.favorite)
    : deduped.filter((i) => bucketOf(i) === queue);
  const shown = filterSort(base);

  const TABS: { key: Queue; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "to_watch", label: "Watchlist" },
    { key: "watched", label: "Watched" },
  ];

  return (
    <div className="space-y-6">
      {/* Queue tabs + Add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-border bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setQueue(t.key);
                setFavOnly(false);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${FOCUS_RING} ${
                !favOnly && queue === t.key ? "bg-media text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label} · {counts[t.key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1.5 rounded-full bg-media px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add title
        </button>
      </div>

      {/* Search + compact icon filters, all on one row */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your titles"
            className={`w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
          />
        </div>
        <IconSelect
          icon={<Film className="h-4 w-4" />}
          title="Filter by type"
          value={media}
          active={media !== "all"}
          activeClass={ACCENT_ACTIVE}
          onChange={(v) => setMedia(v as MediaFilter)}
        >
          <option value="all">All types</option>
          <option value="movie">Films</option>
          <option value="tv">TV</option>
        </IconSelect>
        {providerNames.length > 0 && (
          <IconSelect
            icon={<Tv className="h-4 w-4" />}
            title="Filter by service"
            value={provider}
            active={provider !== "all"}
            activeClass={ACCENT_ACTIVE}
            onChange={setProvider}
          >
            <option value="all">Any service</option>
            {providerNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </IconSelect>
        )}
        <IconSelect
          icon={<ArrowDownUp className="h-4 w-4" />}
          title="Sort"
          value={effectiveSort}
          active={effectiveSort !== "added"}
          activeClass={ACCENT_ACTIVE}
          onChange={(v) => setSort(v as SortKey)}
        >
          <option value="added">Newest</option>
          <option value="year">Year</option>
          {queue === "watched" && <option value="rating">Rating</option>}
        </IconSelect>
        {(favOnly || favCount > 0) && (
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            title="Favorites"
            aria-pressed={favOnly}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
              favOnly
                ? "border-transparent bg-media text-white"
                : "border-border bg-card text-ink-soft"
            }`}
          >
            <Star className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {shown.length > 0 ? (
        <>
          <Grid
            items={shown}
            onToggleWatched={onToggleWatched}
            onAddToWatchlist={onAddToWatchlist}
            onToggleFavorite={onToggleFavorite}
          />
          {canLoadMore && <LoadMoreButton onClick={loadMore} />}
        </>
      ) : base.length > 0 ? (
        <div className="py-16 text-center text-sm text-ink-soft">No titles match your filters.</div>
      ) : favOnly ? (
        <div className="mx-auto max-w-md py-16 text-center">
          <Star className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">No favorites yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            Tap the star on a title to keep your all-time favorites here, across every bucket.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-md py-16 text-center">
          <Clapperboard className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">{EMPTY[queue].title}</p>
          <p className="mt-1 text-sm text-ink-soft">{EMPTY[queue].body}</p>
        </div>
      )}

      {adding && <AddTitleSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
