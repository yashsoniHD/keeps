import { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  ArrowDownUp,
  ChefHat,
  Clock,
  Globe,
  Gauge,
  Plus,
  Search,
  ShoppingCart,
  Star,
  X,
} from "lucide-react";
import { watchRecipeItems } from "@/lib/firestore";
import { updateRecipeItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import type { RecipeItem } from "@/lib/types";
import {
  IconSelect,
  LoadMoreButton,
  WALL_GRID,
  WallError,
  WallSkeleton,
  useWallItems,
} from "@/components/mini-apps/wall";
import { RecipeCard } from "./RecipeCard";
import { AddRecipeSheet } from "./AddRecipeSheet";
import { GroceryListSheet } from "./GroceryListSheet";

type SortKey = "added" | "time";
type TimeBucket = "all" | "u30" | "30_60" | "60p";

// Full literals so the Tailwind JIT sees them (see mini-apps/wall.tsx).
const ACCENT_ACTIVE = "bg-recipe text-white";

const dedupeKey = (i: RecipeItem) =>
  i.source_url?.trim().toLowerCase() ||
  `${(i.title ?? "").toLowerCase().trim().replace(/\s+/g, " ")}`;

// Collapse the same recipe saved across multiple notes into one card, keyed by source URL (falling
// back to title). OR the favorite flag across copies so a ⭐ is never lost.
function dedupeItems(list: RecipeItem[]): RecipeItem[] {
  const best = new Map<string, RecipeItem>();
  const fav = new Map<string, boolean>();
  for (const i of list) {
    const k = dedupeKey(i);
    fav.set(k, (fav.get(k) ?? false) || !!i.favorite);
    if (!best.has(k)) best.set(k, i);
  }
  return [...best.entries()].map(([k, i]) => ({ ...i, favorite: fav.get(k) || i.favorite }));
}

// Best-effort minutes from a freeform time string ("35 min", "1 hr 10 min", "1h"). Returns null
// when nothing parses, so those recipes sort/filter as "unknown" rather than 0.
function parseMinutes(raw?: string | null): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  let mins = 0;
  let found = false;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour)/);
  if (h) {
    mins += parseFloat(h[1]) * 60;
    found = true;
  }
  const m = s.match(/(\d+)\s*(m|min)/);
  if (m) {
    mins += parseInt(m[1], 10);
    found = true;
  }
  if (!found) {
    const n = s.match(/(\d+)/); // a bare number → assume minutes
    if (n) {
      mins = parseInt(n[1], 10);
      found = true;
    }
  }
  return found ? mins : null;
}

function inBucket(mins: number | null, bucket: TimeBucket): boolean {
  if (bucket === "all") return true;
  if (mins == null) return false;
  if (bucket === "u30") return mins < 30;
  if (bucket === "30_60") return mins >= 30 && mins <= 60;
  return mins > 60; // "60p"
}

// The Recipes mini-app body: a live cookbook wall over the user's recipe_items. Unlike the other
// mini-apps there's no status workflow — recipes are organised by filters (cuisine / difficulty /
// time) + a Favorites ⭐ toggle. A "grocery list" mode turns the wall into a multi-select for
// building a combined, checkable shopping list from the selected recipes' ingredients.
export function RecipesView({ uid }: { uid: string }) {
  const { items, setItems, error, retry, canLoadMore, loadMore } = useWallItems<RecipeItem>(
    uid,
    watchRecipeItems,
  );
  const [query, setQuery] = useState("");
  // Deferred so a keystroke doesn't synchronously re-filter and re-render the whole wall.
  const deferredQuery = useDeferredValue(query);
  const [cuisine, setCuisine] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [time, setTime] = useState<TimeBucket>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [favOnly, setFavOnly] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showList, setShowList] = useState(false);

  const deduped = useMemo(() => dedupeItems(items ?? []), [items]);

  const cuisineNames = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped) if (i.cuisine) s.add(i.cuisine);
    return [...s].sort();
  }, [deduped]);

  // Stable identities (useCallback) so the memoized RecipeCards skip re-rendering when
  // unrelated state (search text, filters) changes.
  const patchLocal = useCallback(
    (id: string, patch: Partial<RecipeItem>) =>
      setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i)) ?? prev),
    [setItems],
  );

  const onToggleFavorite = useCallback(
    async (item: RecipeItem) => {
      const next = !item.favorite;
      patchLocal(item.id, { favorite: next });
      try {
        await updateRecipeItem(item.id, { favorite: next });
      } catch {
        patchLocal(item.id, { favorite: item.favorite }); // revert on failure
      }
    },
    [patchLocal],
  );

  const onToggleSelect = useCallback(
    (item: RecipeItem) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      }),
    [],
  );

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const filterSort = (list: RecipeItem[]) => {
    let out = list;
    const q = deferredQuery.trim().toLowerCase();
    if (q)
      out = out.filter(
        (i) =>
          (i.title ?? "").toLowerCase().includes(q) || (i.cuisine ?? "").toLowerCase().includes(q),
      );
    if (cuisine !== "all") out = out.filter((i) => i.cuisine === cuisine);
    if (difficulty !== "all")
      out = out.filter((i) => (i.difficulty ?? "").toLowerCase() === difficulty);
    if (time !== "all") out = out.filter((i) => inBucket(parseMinutes(i.total_time), time));
    const sorted = [...out];
    // Quick recipes first; unknown times sort last.
    if (sort === "time")
      sorted.sort(
        (a, b) =>
          (parseMinutes(a.total_time) ?? Infinity) - (parseMinutes(b.total_time) ?? Infinity),
      );
    // "added" keeps the listener's created_at-desc order.
    return sorted;
  };

  if (error && items === null) return <WallError onRetry={retry} />;
  if (items === null) return <WallSkeleton aspect="aspect-[4/3]" />;

  const favCount = deduped.filter((i) => i.favorite).length;
  const base = favOnly ? deduped.filter((i) => i.favorite) : deduped;
  const shown = filterSort(base);
  const selectedItems = deduped.filter((i) => selected.has(i.id));

  return (
    <div className="space-y-6">
      {/* Top row: grocery-list mode toggle + Add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {selecting ? (
          <button
            type="button"
            onClick={exitSelecting}
            className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSelecting(true)}
            disabled={deduped.length === 0}
            className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-recipe-soft disabled:opacity-50 ${FOCUS_RING}`}
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Make grocery list
          </button>
        )}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1.5 rounded-full bg-recipe px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add recipe
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
            placeholder="Search your recipes"
            className={`w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
          />
        </div>
        {cuisineNames.length > 0 && (
          <IconSelect
            icon={<Globe className="h-4 w-4" />}
            title="Filter by cuisine"
            value={cuisine}
            active={cuisine !== "all"}
            activeClass={ACCENT_ACTIVE}
            onChange={setCuisine}
          >
            <option value="all">Any cuisine</option>
            {cuisineNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </IconSelect>
        )}
        <IconSelect
          icon={<Gauge className="h-4 w-4" />}
          title="Filter by effort"
          value={difficulty}
          active={difficulty !== "all"}
          activeClass={ACCENT_ACTIVE}
          onChange={setDifficulty}
        >
          <option value="all">Any effort</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </IconSelect>
        <IconSelect
          icon={<Clock className="h-4 w-4" />}
          title="Filter by time"
          value={time}
          active={time !== "all"}
          activeClass={ACCENT_ACTIVE}
          onChange={(v) => setTime(v as TimeBucket)}
        >
          <option value="all">Any time</option>
          <option value="u30">Under 30 min</option>
          <option value="30_60">30–60 min</option>
          <option value="60p">Over 60 min</option>
        </IconSelect>
        <IconSelect
          icon={<ArrowDownUp className="h-4 w-4" />}
          title="Sort"
          value={sort}
          active={sort !== "added"}
          activeClass={ACCENT_ACTIVE}
          onChange={(v) => setSort(v as SortKey)}
        >
          <option value="added">Newest</option>
          <option value="time">Quickest</option>
        </IconSelect>
        {(favOnly || favCount > 0) && (
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            title="Favorites"
            aria-pressed={favOnly}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
              favOnly
                ? "border-transparent bg-recipe text-white"
                : "border-border bg-card text-ink-soft"
            }`}
          >
            <Star className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {shown.length > 0 ? (
        <>
          <div className={WALL_GRID}>
            {shown.map((i) => (
              <RecipeCard
                key={i.id}
                item={i}
                selecting={selecting}
                selected={selected.has(i.id)}
                onToggleSelect={onToggleSelect}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
          {canLoadMore && <LoadMoreButton onClick={loadMore} />}
        </>
      ) : base.length > 0 ? (
        <div className="py-16 text-center text-sm text-ink-soft">
          No recipes match your filters.
        </div>
      ) : favOnly ? (
        <div className="mx-auto max-w-md py-16 text-center">
          <Star className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">No favorites yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            Tap the star on a recipe to keep your go-to dishes here.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-md py-16 text-center">
          <ChefHat className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">Save a recipe and it lands here</p>
          <p className="mt-1 text-sm text-ink-soft">
            Share a recipe link and we’ll pull the ingredients, steps and photo into your cookbook —
            then select a few to build a combined grocery list.
          </p>
        </div>
      )}

      {/* Sticky "build list" bar while selecting */}
      {selecting && (
        <div className="sticky bottom-4 z-10 mx-auto flex max-w-sm items-center justify-center">
          <button
            type="button"
            onClick={() => setShowList(true)}
            disabled={selected.size === 0}
            className={`inline-flex items-center gap-2 rounded-full bg-recipe px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
          >
            <ShoppingCart className="h-4 w-4" />
            Build list ({selected.size})
          </button>
        </div>
      )}

      {adding && <AddRecipeSheet onClose={() => setAdding(false)} />}
      {showList && (
        <GroceryListSheet uid={uid} items={selectedItems} onClose={() => setShowList(false)} />
      )}
    </div>
  );
}
