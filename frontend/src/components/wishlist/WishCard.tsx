import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShoppingBag, Check, Star, Plus, Tag } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { WishItem } from "@/lib/types";

const PRODUCT_ACCENT = paletteAccent(2); // the "product" palette, shared with product notes

// Products aren't fixed-aspect posters, so the image is object-contained on a soft panel (never
// cropped) rather than cover-filled like a movie poster.
function ProductImage({ item }: { item: WishItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`relative aspect-square w-full overflow-hidden rounded-xl ${PRODUCT_ACCENT.soft}`}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <ShoppingBag className={`h-1/4 w-1/4 opacity-50 ${PRODUCT_ACCENT.text}`} />
      </div>
      {item.image_url && !failed && (
        <img
          src={item.image_url}
          alt={item.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-contain p-3"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

// One product card. Tapping the image opens the product-detail page; the bought toggle and the
// "+ Wishlist" promote action (Saved items only) write through the backend (optimistic — handled
// by the parent).
export function WishCard({
  item,
  onToggleBought,
  onAddToWishlist,
  onToggleFavorite,
}: {
  item: WishItem;
  onToggleBought: (item: WishItem) => void;
  onAddToWishlist: (item: WishItem) => void;
  onToggleFavorite: (item: WishItem) => void;
}) {
  const bought = item.wish_status === "purchased";
  const saved = item.wish_status === "saved";
  const favorite = !!item.favorite;
  // A target the current price has met → flag the deal.
  const dealMet =
    item.target_price != null &&
    item.price_amount != null &&
    item.price_amount <= item.target_price;

  return (
    <div className="group relative flex min-w-0 flex-col gap-2">
      <div className="relative">
        <Link to="/wishlist/$itemId" params={{ itemId: item.id }} className="block">
          <ProductImage item={item} />
        </Link>
        {/* Overlay actions (top-right): bought toggle + favorite star */}
        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1.5">
          <button
            type="button"
            aria-label={bought ? "Mark as not bought" : "Mark as bought"}
            title={bought ? "Bought" : "Mark bought"}
            onClick={() => onToggleBought(item)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-colors ${FOCUS_RING} ${
              bought
                ? "border-transparent bg-product text-white"
                : "border-border bg-background/80 text-ink-soft hover:text-ink"
            }`}
          >
            {bought ? <Check className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
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
        {/* Deal-met chip */}
        {dealMet && !bought && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-medium text-white">
            <Tag className="h-3 w-3" />
            Target hit
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink" title={item.title}>
          {item.title}
        </p>
        {item.brand && <p className="truncate text-xs text-ink-soft">{item.brand}</p>}
      </div>

      {/* Price + review rating */}
      <div className="flex items-center justify-between gap-2">
        {item.price_raw ? (
          <span className="text-sm font-semibold text-ink">{item.price_raw}</span>
        ) : (
          <span className="text-xs text-ink-soft">No price</span>
        )}
        {item.rating ? (
          <span className="inline-flex items-center gap-0.5 text-xs text-ink-soft">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            {item.rating}
          </span>
        ) : null}
      </div>

      {/* Promote a Saved (inbox) item onto the wishlist */}
      {saved && (
        <button
          type="button"
          onClick={() => onAddToWishlist(item)}
          className={`inline-flex w-full items-center justify-center gap-1 rounded-full border border-border bg-card px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-product-soft ${FOCUS_RING}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Wishlist
        </button>
      )}
    </div>
  );
}
