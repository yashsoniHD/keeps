import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownUp, Globe, Plus, Search, ShoppingBag, Star } from "lucide-react";
import { watchWishItems } from "@/lib/firestore";
import { updateWishItem } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import type { WishItem } from "@/lib/types";
import { WishCard } from "./WishCard";
import { AddProductSheet } from "./AddProductSheet";

type SortKey = "added" | "price" | "rating" | "target";
// Two display tabs. "saved" shows both `saved` and legacy `to_buy` docs (display-only merge —
// no data migration); "purchased" is the Bought tab.
type Queue = "saved" | "purchased";

// A compact icon filter: a round button showing only an icon, with the native <select> overlaid
// transparently on top (mirrors the watchlist's IconSelect). The icon fills with the product
// accent while a non-default value is active, so active filters stay visible.
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
          active
            ? "border-transparent bg-product text-white"
            : "border-border bg-card text-ink-soft"
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
    body: "Share a product link or a buying-guide and each product becomes its own card — your wishlist of things you’re considering.",
  },
  purchased: {
    title: "Nothing bought yet",
    body: "Mark a product bought and it moves here, so Saved stays to what you still want.",
  },
};

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
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
  const [items, setItems] = useState<WishItem[] | null>(null);
  const [queue, setQueue] = useState<Queue>("saved");
  const [query, setQuery] = useState("");
  const [store, setStore] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("added");
  const [favOnly, setFavOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => watchWishItems(uid, setItems), [uid]);

  const deduped = useMemo(() => dedupeItems(items ?? []), [items]);

  // The set of stores (domains) the user has products from, for the filter.
  const storeNames = useMemo(() => {
    const s = new Set<string>();
    for (const i of deduped) if (i.domain) s.add(i.domain);
    return [...s].sort();
  }, [deduped]);

  const patchLocal = (id: string, patch: Partial<WishItem>) =>
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, ...patch } : i)) ?? prev);

  // Bought ↔ Saved. Undoing a purchase always lands in `saved` (never back to legacy `to_buy`).
  const onToggleBought = async (item: WishItem) => {
    const next = item.wish_status === "purchased" ? "saved" : "purchased";
    patchLocal(item.id, { wish_status: next });
    try {
      await updateWishItem(item.id, { wish_status: next });
    } catch {
      patchLocal(item.id, { wish_status: item.wish_status }); // revert on failure
    }
  };

  // Cross-cutting ⭐ flag — the "really want this" star, independent of the buy bucket.
  const onToggleFavorite = async (item: WishItem) => {
    const next = !item.favorite;
    patchLocal(item.id, { favorite: next });
    try {
      await updateWishItem(item.id, { favorite: next });
    } catch {
      patchLocal(item.id, { favorite: item.favorite }); // revert on failure
    }
  };

  const filterSort = (list: WishItem[]) => {
    let out = list;
    const q = query.trim().toLowerCase();
    if (q)
      out = out.filter(
        (i) =>
          (i.title ?? "").toLowerCase().includes(q) || (i.brand ?? "").toLowerCase().includes(q),
      );
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

  if (items === null) {
    return (
      <div className="flex justify-center py-20">
        <ShoppingBag className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

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
                  ? "bg-product text-white"
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
          className={`inline-flex items-center gap-1.5 rounded-full bg-product px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Add product
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
            placeholder="Search your products"
            className={`w-full rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
          />
        </div>
        {storeNames.length > 0 && (
          <IconSelect
            icon={<Globe className="h-4 w-4" />}
            title="Filter by store"
            value={store}
            active={store !== "all"}
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
                ? "border-transparent bg-product text-white"
                : "border-border bg-card text-ink-soft"
            }`}
          >
            <Star className={`h-4 w-4 ${favOnly ? "fill-current" : ""}`} />
          </button>
        )}
      </div>

      {shown.length > 0 ? (
        <Grid items={shown} onToggleBought={onToggleBought} onToggleFavorite={onToggleFavorite} />
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
