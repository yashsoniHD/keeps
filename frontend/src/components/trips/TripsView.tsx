import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownUp, Calendar, MapPin, Plane, Plus, Search, Star, Sun } from "lucide-react";
import { watchTripItems } from "@/lib/firestore";
import { updateTripItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import type { TripItem } from "@/lib/types";
import { TripCard } from "./TripCard";
import { AddTripSheet } from "./AddTripSheet";

type SortKey = "added" | "duration";
type LengthBucket = "all" | "weekend" | "week" | "long";

// A compact icon filter: a round button showing only an icon, with the native <select> overlaid
// transparently on top (mirrors the recipes app's IconSelect). The icon fills with the trip accent
// while a non-default value is active, so active filters stay visible.
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
          active ? "border-transparent bg-trip text-white" : "border-border bg-card text-ink-soft"
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

const dedupeKey = (i: TripItem) =>
  i.source_url?.trim().toLowerCase() ||
  `${(i.title ?? "").toLowerCase().trim().replace(/\s+/g, " ")}`;

// Collapse the same trip saved across multiple notes into one card, keyed by source URL (falling
// back to title). OR the favorite flag across copies so a ⭐ is never lost.
function dedupeItems(list: TripItem[]): TripItem[] {
  const best = new Map<string, TripItem>();
  const fav = new Map<string, boolean>();
  for (const i of list) {
    const k = dedupeKey(i);
    fav.set(k, (fav.get(k) ?? false) || !!i.favorite);
    if (!best.has(k)) best.set(k, i);
  }
  return [...best.entries()].map(([k, i]) => ({ ...i, favorite: fav.get(k) || i.favorite }));
}

// Best-effort number of days from a freeform duration string ("3 days", "1 week", "10-day"). Falls
// back to the day plan's length, then null so unparseable trips sort/filter as "unknown".
function parseDays(item: TripItem): number | null {
  const raw = (item.duration ?? "").toLowerCase();
  const weeks = raw.match(/(\d+)\s*week/);
  if (weeks) return parseInt(weeks[1], 10) * 7;
  const days = raw.match(/(\d+)\s*(day|night|-day)/);
  if (days) return parseInt(days[1], 10);
  const bare = raw.match(/(\d+)/);
  if (bare) return parseInt(bare[1], 10);
  return item.days?.length ? item.days.length : null;
}

function inBucket(days: number | null, bucket: LengthBucket): boolean {
  if (bucket === "all") return true;
  if (days == null) return false;
  if (bucket === "weekend") return days <= 3;
  if (bucket === "week") return days >= 4 && days <= 7;
  return days > 7; // "long"
}

// The Trips mini-app body: a live wall over the user's trip_items. Like the recipes app there's no
// status workflow — trips are organised by filters (destination / length / season) + a Favorites ⭐
// toggle, sorted newest-first or by trip length.
export function TripsView({ uid }: { uid: string }) {
  const [items, setItems] = useState<TripItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState("all");
  const [length, setLength] = useState<LengthBucket>("all");
  const [season, setSeason] = useState("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [favOnly, setFavOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => watchTripItems(uid, setItems), [uid]);

  const deduped = useMemo(() => dedupeItems(items ?? []), [items]);

  const destinations = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped) if (i.destination) s.add(i.destination);
    return [...s].sort();
  }, [deduped]);

  const seasons = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped) if (i.best_season) s.add(i.best_season);
    return [...s].sort();
  }, [deduped]);

  const patchLocal = (id: string, patch: Partial<TripItem>) =>
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i)) ?? prev);

  const onToggleFavorite = async (item: TripItem) => {
    const next = !item.favorite;
    patchLocal(item.id, { favorite: next });
    try {
      await updateTripItem(item.id, { favorite: next });
    } catch {
      patchLocal(item.id, { favorite: item.favorite }); // revert on failure
    }
  };

  const filterSort = (list: TripItem[]) => {
    let out = list;
    const q = query.trim().toLowerCase();
    if (q)
      out = out.filter(
        (i) =>
          (i.title ?? "").toLowerCase().includes(q) ||
          (i.destination ?? "").toLowerCase().includes(q),
      );
    if (destination !== "all") out = out.filter((i) => i.destination === destination);
    if (season !== "all") out = out.filter((i) => i.best_season === season);
    if (length !== "all") out = out.filter((i) => inBucket(parseDays(i), length));
    const sorted = [...out];
    // Shortest trips first; unknown lengths sort last.
    if (sort === "duration")
      sorted.sort((a, b) => (parseDays(a) ?? Infinity) - (parseDays(b) ?? Infinity));
    // "added" keeps the listener's created_at-desc order.
    return sorted;
  };

  if (items === null) {
    return (
      <div className="flex justify-center py-20">
        <Plane className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  const favCount = deduped.filter((i) => i.favorite).length;
  const base = favOnly ? deduped.filter((i) => i.favorite) : deduped;
  const shown = filterSort(base);

  return (
    <div className="space-y-6">
      {/* Top row: Add */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1.5 rounded-full bg-trip px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add trip
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
            placeholder="Search your trips"
            className={`w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
          />
        </div>
        {destinations.length > 0 && (
          <IconSelect
            icon={<MapPin className="h-4 w-4" />}
            title="Filter by destination"
            value={destination}
            active={destination !== "all"}
            onChange={setDestination}
          >
            <option value="all">Any destination</option>
            {destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </IconSelect>
        )}
        <IconSelect
          icon={<Calendar className="h-4 w-4" />}
          title="Filter by length"
          value={length}
          active={length !== "all"}
          onChange={(v) => setLength(v as LengthBucket)}
        >
          <option value="all">Any length</option>
          <option value="weekend">Weekend (≤3 days)</option>
          <option value="week">A week (4–7 days)</option>
          <option value="long">Longer (8+ days)</option>
        </IconSelect>
        {seasons.length > 0 && (
          <IconSelect
            icon={<Sun className="h-4 w-4" />}
            title="Filter by season"
            value={season}
            active={season !== "all"}
            onChange={setSeason}
          >
            <option value="all">Any season</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
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
          <option value="duration">Shortest</option>
        </IconSelect>
        {(favOnly || favCount > 0) && (
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            title="Favorites"
            aria-pressed={favOnly}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
              favOnly
                ? "border-transparent bg-trip text-white"
                : "border-border bg-card text-ink-soft"
            }`}
          >
            <Star className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {shown.map((i) => (
            <TripCard key={i.id} item={i} onToggleFavorite={onToggleFavorite} />
          ))}
        </div>
      ) : base.length > 0 ? (
        <div className="py-16 text-center text-sm text-ink-soft">No trips match your filters.</div>
      ) : favOnly ? (
        <div className="mx-auto max-w-md py-16 text-center">
          <Star className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">No favorites yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            Tap the star on a trip to keep your dream destinations here.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-md py-16 text-center">
          <Plane className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">Save a trip and it lands here</p>
          <p className="mt-1 text-sm text-ink-soft">
            Share an itinerary link and we’ll pull the day-by-day plan, stops and photo into your
            trips — with each stop pinned on a map.
          </p>
        </div>
      )}

      {adding && <AddTripSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
