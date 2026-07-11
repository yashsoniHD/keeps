import { useDeferredValue, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownUp,
  Grid3x3,
  List,
  Map as MapIcon,
  MapPin,
  Plus,
  Search,
  Star,
  Tag,
} from "lucide-react";
import { watchPlaceItems } from "@/lib/firestore";
import { FOCUS_RING } from "@/lib/ui";
import type { PlaceItem } from "@/lib/types";
import {
  IconSelect,
  LoadMoreButton,
  WALL_GRID,
  WallError,
  WallSkeleton,
  useWallItems,
} from "@/components/mini-apps/wall";
import { PlaceCard } from "./PlaceCard";
import { PlaceRow } from "./PlaceCard";
import { PlacesMap } from "./PlacesMap";
import { AddPlaceSheet } from "./AddPlaceSheet";

type SortKey = "added" | "rating";
type Tab = "saved" | "starred";
type ViewMode = "grid" | "list" | "map";

// Full literals so the Tailwind JIT sees them (see mini-apps/wall.tsx).
const ACCENT_ACTIVE = "bg-place text-white";

const STATUS_RANK: Record<PlaceItem["place_status"], number> = {
  visited: 2,
  to_visit: 1,
  saved: 0,
};

const dedupeKey = (i: PlaceItem) =>
  i.place_id?.trim().toLowerCase() ||
  `${(i.name ?? "").toLowerCase().trim()}|${(i.city ?? "").toLowerCase().trim()}`;

// Collapse the same venue saved across multiple notes into one card, keyed by Google place_id
// (falling back to name+city). Keep the most-progressed copy (visited > to_visit > saved), and OR
// the favorite flag across copies so a favorited duplicate never loses its ⭐.
function dedupeItems(list: PlaceItem[]): PlaceItem[] {
  const best = new Map<string, PlaceItem>();
  const fav = new Map<string, boolean>();
  for (const i of list) {
    const k = dedupeKey(i);
    fav.set(k, (fav.get(k) ?? false) || !!i.favorite);
    const cur = best.get(k);
    if (!cur || STATUS_RANK[i.place_status] > STATUS_RANK[cur.place_status]) best.set(k, i);
  }
  return [...best.entries()].map(([k, i]) => ({ ...i, favorite: fav.get(k) || i.favorite }));
}

// Two tabs: Saved is everything you've captured; Starred is the cross-cutting ⭐ shortlist.
// Neither hides a place — Starred is just the subset you've flagged.
const EMPTY: Record<Tab, { title: string; body: string }> = {
  saved: {
    title: "Save a place and it lands here",
    body: "Share a reel or article about restaurants, cafés or bars and each venue becomes its own card. Everything you save lives here.",
  },
  starred: {
    title: "No starred places yet",
    body: "Open a place and tap the star to keep your go-to spots — and the ones you most want to try — in one shortlist.",
  },
};

function Grid({ items }: { items: PlaceItem[] }) {
  return (
    <div className={WALL_GRID}>
      {items.map((i) => (
        <PlaceCard key={i.id} item={i} />
      ))}
    </div>
  );
}

function ListView({ items }: { items: PlaceItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <PlaceRow key={i.id} item={i} />
      ))}
    </div>
  );
}

// The Places mini-app body: a live venue collection under two tabs — Saved (everything captured
// from place notes or added manually) and Starred (the places you've flagged with the ⭐).
// Grid / List views plus city/category filters and a search picker. Cards are lean (tap to open);
// all actions live on the detail page. Owns the place_items listener.
export function PlacesView({ uid }: { uid: string }) {
  const { items, error, retry, canLoadMore, loadMore } = useWallItems<PlaceItem>(
    uid,
    watchPlaceItems,
  );
  const [tab, setTab] = useState<Tab>("saved");
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  // Deferred so a keystroke doesn't synchronously re-filter and re-render the whole wall.
  const deferredQuery = useDeferredValue(query);
  const [city, setCity] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [adding, setAdding] = useState(false);

  const deduped = useMemo(() => dedupeItems(items ?? []), [items]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped) if (i.city) s.add(i.city);
    return [...s].sort();
  }, [deduped]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped) if (i.category) s.add(i.category);
    return [...s].sort();
  }, [deduped]);

  const filterSort = (list: PlaceItem[]) => {
    let out = list;
    const q = deferredQuery.trim().toLowerCase();
    if (q)
      out = out.filter(
        (i) =>
          (i.name ?? "").toLowerCase().includes(q) ||
          (i.cuisine ?? "").toLowerCase().includes(q) ||
          (i.category ?? "").toLowerCase().includes(q),
      );
    if (city !== "all") out = out.filter((i) => i.city === city);
    if (category !== "all") out = out.filter((i) => i.category === category);
    const sorted = [...out];
    if (sort === "rating") sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    return sorted;
  };

  if (error && items === null) return <WallError onRetry={retry} />;
  if (items === null) return <WallSkeleton aspect="aspect-[4/3]" />;

  const counts = {
    saved: deduped.length,
    starred: deduped.filter((i) => i.favorite).length,
  };
  const base = tab === "starred" ? deduped.filter((i) => i.favorite) : deduped;
  const shown = filterSort(base);

  const TABS: { key: Tab; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "starred", label: "Starred" },
  ];

  const VIEWS: { key: ViewMode; icon: ReactNode; label: string }[] = [
    { key: "grid", icon: <Grid3x3 className="h-4 w-4" />, label: "Grid" },
    { key: "list", icon: <List className="h-4 w-4" />, label: "List" },
    { key: "map", icon: <MapIcon className="h-4 w-4" />, label: "Map" },
  ];

  return (
    <div className="space-y-6">
      {/* Saved / Starred tabs + Add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-border bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${FOCUS_RING} ${
                tab === t.key ? "bg-place text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label} · {counts[t.key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1.5 rounded-full bg-place px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add place
        </button>
      </div>

      {/* Search + view toggle + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your places"
            className={`w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
          />
        </div>

        <div className="inline-flex rounded-full border border-border bg-card p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              title={v.label}
              aria-label={v.label}
              onClick={() => setView(v.key)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors ${FOCUS_RING} ${
                view === v.key ? "bg-place text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              {v.icon}
            </button>
          ))}
        </div>

        {categories.length > 0 && (
          <IconSelect
            icon={<Tag className="h-4 w-4" />}
            title="Filter by category"
            value={category}
            active={category !== "all"}
            activeClass={ACCENT_ACTIVE}
            onChange={setCategory}
          >
            <option value="all">Any type</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </IconSelect>
        )}
        <IconSelect
          icon={<ArrowDownUp className="h-4 w-4" />}
          title="Sort"
          value={sort}
          active={sort !== "added"}
          activeClass={ACCENT_ACTIVE}
          onChange={(v) => setSort(v as SortKey)}
        >
          <option value="added">Newest</option>
          <option value="rating">Rating</option>
        </IconSelect>
      </div>

      {/* City chips — the way you actually browse places ("what did I save in Goa?"). */}
      {cities.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {["all", ...cities].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCity(c)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${FOCUS_RING} ${
                city === c
                  ? "border-transparent bg-place text-white"
                  : "border-border bg-card text-ink-soft hover:text-ink"
              }`}
            >
              {c === "all" ? "Everywhere" : c}
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 ? (
        <>
          {view === "grid" ? (
            <Grid items={shown} />
          ) : view === "list" ? (
            <ListView items={shown} />
          ) : (
            <PlacesMap items={shown} heightClass="h-[65vh]" />
          )}
          {view !== "map" && canLoadMore && <LoadMoreButton onClick={loadMore} />}
        </>
      ) : base.length > 0 ? (
        <div className="py-16 text-center text-sm text-ink-soft">No places match your filters.</div>
      ) : (
        <div className="mx-auto max-w-md py-16 text-center">
          {tab === "starred" ? (
            <Star className="mx-auto h-10 w-10 text-ink-soft/50" />
          ) : (
            <MapPin className="mx-auto h-10 w-10 text-ink-soft/50" />
          )}
          <p className="mt-4 font-medium text-ink">{EMPTY[tab].title}</p>
          <p className="mt-1 text-sm text-ink-soft">{EMPTY[tab].body}</p>
        </div>
      )}

      {adding && <AddPlaceSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
