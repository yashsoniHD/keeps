import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShoppingBag, Check, Star, Tag } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { formatPrice } from "@/lib/format";
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
// favorite star write through the backend (optimistic — handled by the parent).
export const WishCard = memo(function WishCard({
  item,
  onToggleBought,
  onToggleFavorite,
}: {
  item: WishItem;
  onToggleBought: (item: WishItem) => void;
  onToggleFavorite: (item: WishItem) => void;
}) {
  const bought = item.wish_status === "purchased";
  const favorite = !!item.favorite;
  // A target the current price has met → flag the deal.
  const dealMet =
    item.target_price != null &&
    item.price_amount != null &&
    item.price_amount <= item.target_price;
  const priceLabel = formatPrice(item.price_amount, item.currency, item.price_raw);

  return (
    <div className="group relative flex min-w-0 flex-col gap-2">
      <div className="relative">
        <Link
          to="/wishlist/$itemId"
          params={{ itemId: item.id }}
          className={`press block rounded-xl shadow-sm transition-shadow hover:shadow-md ${FOCUS_RING}`}
        >
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
                ? "border-transparent bg-favorite text-white"
                : "border-border bg-background/80 text-ink-soft hover:text-ink"
            }`}
          >
            <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
          </button>
        </div>
        {/* Deal-met chip */}
        {dealMet && !bought && (
          <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[10px] font-medium text-white">
            <Tag className="h-3 w-3" />
            Target hit
          </span>
        )}
        {/* Price tag ON the image — the number a shopper scans for, worn like a shelf label. */}
        {priceLabel && (
          <span
            className={`absolute bottom-1.5 left-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold shadow-sm backdrop-blur ${
              dealMet && !bought
                ? "border-success/30 bg-success-soft/90 text-success"
                : "border-border bg-card/90 text-ink"
            }`}
          >
            {priceLabel}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink" title={item.title}>
          {item.title}
        </p>
        {/* Brand + store favicon on one quiet line, with the review rating opposite. */}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
            {item.domain && (
              <img
                src={`https://www.google.com/s2/favicons?domain=${item.domain}&sz=32`}
                alt=""
                loading="lazy"
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
              />
            )}
            <span className="truncate">{item.brand || item.domain || ""}</span>
          </span>
          {item.rating ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-soft">
              <Star className="h-3.5 w-3.5 fill-favorite text-favorite" />
              {item.rating}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
});
