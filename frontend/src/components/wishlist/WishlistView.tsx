import { useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownUp, Globe, Plus, ShoppingBag, Star, Tag } from "lucide-react";
import { watchWishItems } from "@/lib/firestore";
import { updateWishItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import { formatPrice } from "@/lib/format";
import type { WishItem } from "@/lib/types";
import {
  IconSelect,
  LoadMoreButton,
  WALL_GRID,
  WallError,
  WallSkeleton,
  useWallItems,
} from "@/components/mini-apps/wall";
import { WishCard } from "./WishCard";
import { AddProductSheet } from "./AddProductSheet";

type SortKey = "added" | "price" | "rating" | "target";
// Two display tabs. "saved" shows both `saved` and legacy `to_buy` docs (display-only merge —
// no data migration); "purchased" is the Bought tab.
type Queue = "saved" | "purchased";

// Full literals so the Tailwind JIT sees them (see mini-apps/wall.tsx).
const ACCENT_ACTIVE = "bg-product text-product-on";

// Status priority for collapsing duplicates: keep the most-progressed copy.
const STATUS_RANK: Record<WishItem["wish_status"], number> = { purchased: 2, to_buy: 1, saved: 0 };

const dedupeKey = (i: WishItem) =>
  i.buy_url?.trim().toLowerCase() ||
  `${(i.brand ?? "").toLowerCase()}|${(i.title ?? "").toLowerCase().trim().replace(/\s+/g, " ")}`;

// Collapse the same product saved across multiple notes into one card, keyed by buy URL (falling
// back to brand+title). When a product survives with more than one status, keep the most-progressed
// copy (purchased > to_buy > saved) so a Bought item never resurfaces in Saved.
function dedupeItems(list: WishItem[]): WishItem[] {
  const best = new Map<string, WishItem>();
  const fav = new Map<string, boolean>();
  for (const i of list) {
    const k = dedupeKey(i);
    fav.set(k, (fav.get(k) ?? false) || !!i.favorite); // OR favorite across copies, never lose a ⭐
    const cur = best.get(k);
    if (!cur || STATUS_RANK[i.wish_status] > STATUS_RANK[cur.wish_status]) best.set(k, i);
  }
  return [...best.entries()].map(([k, i]) => ({ ...i, favorite: fav.get(k) || i.favorite }));
}

const EMPTY: Record<Queue, { title: string; body: string }> = {
  saved: {
    title: "Save a product and it lands here",
    body: "Share a product link or a buying-guide and each product becomes its own card. Your wishlist of things you’re considering.",
  },
  purchased: {
    title: "Nothing bought yet",
    body: "Mark a product bought and it moves here, so Saved stays to what you still want.",
  },
};

// Pinned deals strip: every un-bought product whose price has met its target, surfaced above
// the wall in a success-tinted rail — the "your patience paid off" moment a shopper checks for.
function DealsRail({ items }: { items: WishItem[] }) {
  return (
    <section className="rounded-3xl border border-success/25 bg-success-soft/50 p-4">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-success">
        <Tag className="h-3.5 w-3.5" />
        Below your target
      </h3>
      <div className="-mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-1">
        {items.map((i) => (
          <Link
            key={i.id}
            to="/wishlist/$itemId"
            params={{ itemId: i.id }}
            className={`press flex w-44 shrink-0 items-center gap-2.5 rounded-2xl border border-border bg-card p-2 shadow-sm ${FOCUS_RING}`}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-product-soft/60">
              {i.image_url ? (
                <img
                  src={i.image_url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-contain p-1"
                />
              ) : (
                <ShoppingBag className="h-4 w-4 text-product" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-ink">{i.title}</span>
              <span className="block truncate text-sm font-semibold text-success">
                {formatPrice(i.price_amount, i.currency, i.price_raw)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Grid({
  items,
  onToggleBought,
  onToggleFavorite,
}: {
  items: WishItem[];
  onToggleBought: (i: WishItem) => void;
  onToggleFavorite: (i: WishItem) => void;
}) {
  return (
    <div className={WALL_GRID}>
      {items.map((i) => (
        <WishCard
          key={i.id}
          item={i}
          onToggleBought={onToggleBought}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}

// The Wishlist mini-app body: a live product wall split into two tabs — Saved (auto-captured
// from product notes, plus legacy to_buy docs) and Bought — with a store filter and sort. Owns
// the wish_items listener and applies optimistic state so marking bought feels instant.
export function WishlistView({ uid }: { uid: string }) {
  const { items, setItems, error, retry, canLoadMore, loadMore } = useWallItems<WishItem>(
    uid,
    watchWishItems,
    "wishlist",
  );
  const [queue, setQueue] = useState<Queue>("saved");
  const [store, setStore] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [favOnly, setFavOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  const deduped = useMemo(() => dedupeItems(items ?? []), [items]);

  // The set of stores (domains) the user has products from, for the filter.
  const storeNames = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped) if (i.domain) s.add(i.domain);
    return [...s].sort();
  }, [deduped]);

  // Stable identities (useCallback) so the memoized WishCards skip re-rendering when
  // unrelated state (search text, filters) changes.
  const patchLocal = useCallback(
    (id: string, patch: Partial<WishItem>) =>
      setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i)) ?? prev),
    [setItems],
  );

  // Bought ↔ Saved. Undoing a purchase always lands in `saved` (never back to legacy `to_buy`).
  const onToggleBought = useCallback(
    async (item: WishItem) => {
      const next = item.wish_status === "purchased" ? "saved" : "purchased";
      patchLocal(item.id, { wish_status: next });
      try {
        await updateWishItem(item.id, { wish_status: next });
      } catch {
        patchLocal(item.id, { wish_status: item.wish_status }); // revert on failure
      }
    },
    [patchLocal],
  );

  // Cross-cutting ⭐ flag — the "really want this" star, independent of the buy bucket.
  const onToggleFavorite = useCallback(
    async (item: WishItem) => {
      const next = !item.favorite;
      patchLocal(item.id, { favorite: next });
      try {
        await updateWishItem(item.id, { favorite: next });
      } catch {
        patchLocal(item.id, { favorite: item.favorite }); // revert on failure
      }
    },
    [patchLocal],
  );

  const filterSort = (list: WishItem[]) => {
    let out = list;
    if (store !== "all") out = out.filter((i) => i.domain === store);
    const sorted = [...out];
    // Price low→high is the most useful shopping sort; items without a parsed price sort last.
    if (sort === "price")
      sorted.sort((a, b) => (a.price_amount ?? Infinity) - (b.price_amount ?? Infinity));
    else if (sort === "rating") sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    else if (sort === "target") {
      // Closest to target first: items already at/under their target lead (negative gap), then
      // those approaching it; products with no target (or no price) sort last.
      const gap = (i: WishItem) =>
        i.target_price != null && i.price_amount != null
          ? i.price_amount - i.target_price
          : Infinity;
      sorted.sort((a, b) => gap(a) - gap(b));
    }
    // "added" keeps the listener's created_at-desc order.
    return sorted;
  };

  if (error && items === null) return <WallError onRetry={retry} />;
  if (items === null) return <WallSkeleton aspect="aspect-square" />;

  // "Saved" folds legacy to_buy docs in — display-only, the docs keep their status.
  const inQueue = (i: WishItem, q: Queue) =>
    q === "saved" ? i.wish_status !== "purchased" : i.wish_status === "purchased";
  const counts = {
    saved: deduped.filter((i) => inQueue(i, "saved")).length,
    purchased: deduped.filter((i) => inQueue(i, "purchased")).length,
  };
  const favCount = deduped.filter((i) => i.favorite).length;
  const base = favOnly
    ? deduped.filter((i) => i.favorite)
    : deduped.filter((i) => inQueue(i, queue));
  const shown = filterSort(base);

  // Deals rail: shown on the pristine Saved view only (never over filtered/search results).
  const deals =
    queue === "saved" && !favOnly && store === "all"
      ? deduped.filter(
          (i) =>
            i.wish_status !== "purchased" &&
            i.target_price != null &&
            i.price_amount != null &&
            i.price_amount <= i.target_price,
        )
      : [];

  const TABS: { key: Queue; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "purchased", label: "Bought" },
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
                !favOnly && queue === t.key
                  ? "bg-product text-product-on"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {t.label} · {counts[t.key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1.5 rounded-full bg-product px-3 py-1.5 text-xs font-medium text-product-on transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add product
        </button>
      </div>

      {/* Compact icon filters, all on one row */}
      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {storeNames.length > 0 && (
          <IconSelect
            icon={<Globe className="h-4 w-4" />}
            title="Filter by store"
            value={store}
            active={store !== "all"}
            activeClass={ACCENT_ACTIVE}
            onChange={setStore}
          >
            <option value="all">Any store</option>
            {storeNames.map((s) => (
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
          activeClass={ACCENT_ACTIVE}
          onChange={(v) => setSort(v as SortKey)}
        >
          <option value="added">Newest</option>
          <option value="price">Price</option>
          <option value="rating">Rating</option>
          <option value="target">Closest to target</option>
        </IconSelect>
        {(favOnly || favCount > 0) && (
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            title="Favorites"
            aria-pressed={favOnly}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
              favOnly
                ? "border-transparent bg-product text-product-on"
                : "border-border bg-card text-ink-soft"
            }`}
          >
            <Star className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {shown.length > 0 ? (
        <>
          {deals.length > 0 && <DealsRail items={deals} />}
          <Grid items={shown} onToggleBought={onToggleBought} onToggleFavorite={onToggleFavorite} />
          {canLoadMore && <LoadMoreButton onClick={loadMore} />}
        </>
      ) : base.length > 0 ? (
        <div className="py-16 text-center text-sm text-ink-soft">
          No products match your filters.
        </div>
      ) : favOnly ? (
        <div className="mx-auto max-w-md py-16 text-center">
          <Star className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">No favorites yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            Tap the star on a product to keep the ones you really want here, across both tabs.
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-md py-16 text-center">
          <ShoppingBag className="mx-auto h-10 w-10 text-ink-soft/50" />
          <p className="mt-4 font-medium text-ink">{EMPTY[queue].title}</p>
          <p className="mt-1 text-sm text-ink-soft">{EMPTY[queue].body}</p>
        </div>
      )}

      {adding && <AddProductSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
