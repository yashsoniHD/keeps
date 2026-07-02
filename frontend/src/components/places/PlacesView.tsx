import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDownUp,
  Building2,
  Grid3x3,
  List,
  MapPin,
  Plus,
  Search,
  Star,
  Tag,
} from "lucide-react";
import { watchPlaceItems } from "@/lib/firestore";
import { FOCUS_RING } from "@/lib/ui";
import type { PlaceItem } from "@/lib/types";
import { PlaceCard } from "./PlaceCard";
import { PlaceRow } from "./PlaceCard";
import { AddPlaceSheet } from "./AddPlaceSheet";

type SortKey = "added" | "rating";
type Queue = "saved" | "to_visit" | "visited";
type ViewMode = "grid" | "list";

// Compact icon filter — round button with a transparent native <select> on top (mirrors the
// wishlist/watchlist IconSelect). Fills with the place accent while a non-default value is active.
function IconSelect({
  icon,
  value,
  active,
  onChange,
  title,
  children,
}: {
  icon: ReactNode;
  value: string;
  active: boolean;
  onChange: (v: string) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <span
        aria-hidden
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          active ? "border-transparent bg-itinerary text-white" : "border-border bg-card text-ink-soft"
        } ${FOCUS_RING}`}
      >
        {icon}
      </span>
      <select
        aria-label={title}
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {children}
      </select>
    </div>
  );
}

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

// A place is revisitable, so "Been" is a sticky attribute, not a terminal state — these buckets
// never hide a place, they just describe your relationship to it.
const EMPTY: Record<Queue, { title: string; body: string }> = {
  saved: {
    title: "Save a place and it lands here",
    body: "Share a reel or article about restaurants, cafés or bars and each venue becomes its own card. Open one and tap “Want to go” to shortlist the places you actually want to visit.",
  },
  to_visit: {
    title: "Your want-to-go list is empty",
    body: "Open a saved place and tap “Want to go”, or search to add one directly — this is your shortlist of where to head next.",
  },
  visited: {
    title: "Nowhere marked Been yet",
    body: "Open a place and mark it Been — it stays here as your personal map, where you can rate it, jot a note, and log each time you go back.",
  },
};

function Grid({ items }: { items: PlaceItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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

// The Places mini-app body: a live venue collection split into three buckets — Saved (auto-captured
// from place notes, the inbox) → Want to go (shortlisted) → Been (sticky; visited at least once).
// Grid / List views, city/category filters, a search picker, and a cross-cutting Favorites chip.
// Cards are lean (tap to open); all actions live on the detail page. Owns the place_items listener.
export function PlacesView({ uid }: { uid: string }) {
  const [items, setItems] = useState<PlaceItem[] | null>(null);
  const [queue, setQueue] = useState<Queue>("saved");
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [favOnly, setFavOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => watchPlaceItems(uid, setItems), [uid]);

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
    const q = query.trim().toLowerCase();
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

  if (items === null) {
    return (
      <div className="flex justify-center py-20">
        <MapPin className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  const counts = {
    saved: deduped.filter((i) => i.place_status === "saved").length,
    to_visit: deduped.filter((i) => i.place_status === "to_visit").length,
    visited: deduped.filter((i) => i.place_status === "visited").length,
  };
  const favCount = deduped.filter((i) => i.favorite).length;
  const base = favOnly
    ? deduped.filter((i) => i.favorite)
    : deduped.filter((i) => i.place_status === queue);
  const shown = filterSort(base);

  const TABS: { key: Queue; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "to_visit", label: "Want to go" },
    { key: "visited", label: "Been" },
  ];

  const VIEWS: { key: ViewMode; icon: ReactNode; label: string }[] = [
    { key: "grid", icon: <Grid3x3 className="h-4 w-4" />, label: "Grid" },
    { key: "list", icon: <List className="h-4 w-4" />, label: "List" },
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
                !favOnly && queue === t.key ? "bg-itinerary text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label} · {counts[t.key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1.5 rounded-full bg-itinerary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
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
                view === v.key ? "bg-itinerary text-white" : "text-ink-soft hover:text-ink"
              }`}
            >
              {v.icon}
            </button>
          ))}
        </div>

        {cities.length > 0 && (
          <IconSelect
            icon={<Building2 className="h-4 w-4" />}
            title="Filter by city"
            value={city}
            active={city !== "all"}
            onChange={setCity}
          >
            <option value="all">Any city</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </IconSelect>
        )}
        {categories.length > 0 && (
          <IconSelect
            icon={<Tag className="h-4 w-4" />}
            title="Filter by category"
            value={category}
            active={category !== "all"}
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
          onChange={(v) => setSort(v as SortKey)}
        >
          <option value="added">Newest</option>
          <option value="rating">Rating</option>
        </IconSelect>
        {(favOnly || favCount > 0) && (
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            title="Favorites"
            aria-pressed={favOnly}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
              favOnly ? "border-transparent bg-itinerary text-white" : "border-border bg-card text-ink-soft"
            }`}
          >
            <Star className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {shown.length > 0 ? (
        view === "grid" ? (
          <Grid items={shown} />
        ) : (
          <ListView items={shown} />
        )
      ) : base.length > 0 ? (
        <div className="py-16 text-center text-sm text-ink-soft">No places match your filters.</div>
      ) : favOnly ? (
        <div className="mx-auto max-w-md py-16 text-center">
          <Star className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">No favorites yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            Tap the star on a place to keep your go-to spots here, across every bucket.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-md py-16 text-center">
          <MapPin className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">{EMPTY[queue].title}</p>
          <p className="mt-1 text-sm text-ink-soft">{EMPTY[queue].body}</p>
        </div>
      )}

      {adding && <AddPlaceSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
