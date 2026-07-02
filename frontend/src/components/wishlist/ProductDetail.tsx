import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ShoppingBag,
  Check,
  Star,
  Trash2,
  FileText,
  Loader2,
  Plus,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Tag,
} from "lucide-react";
import { watchWishItem, getNote } from "@/lib/firestore";
import { updateWishItem, deleteWishItem } from "@/lib/api";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import type { WishItem } from "@/lib/types";

const PRODUCT = paletteAccent(2);

// The product detail page: image, price + buy link, your status, a price target, specs, pros/cons,
// the verdict, and links back to the notes it came from. Live-listens to the item so toggles
// persist visibly. Unlike the watchlist there's no external details fetch — a product note arrives
// fully structured, so everything is already on the item doc.
export function ProductDetail({
  uid,
  itemId,
  onDeleted,
}: {
  uid: string;
  itemId: string;
  onDeleted: () => void;
}) {
  const [item, setItem] = useState<WishItem | null | undefined>(undefined); // undefined = loading
  const [sources, setSources] = useState<{ id: string; title: string }[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [targetDraft, setTargetDraft] = useState("");

  useEffect(() => watchWishItem(uid, itemId, setItem), [uid, itemId]);

  // Seed the target-price input from the stored value once the item loads.
  useEffect(() => {
    if (item) setTargetDraft(item.target_price != null ? String(item.target_price) : "");
  }, [item?.target_price]);

  useEffect(() => {
    const ids = item?.source_note_ids ?? [];
    if (ids.length === 0) {
      setSources([]);
      return;
    }
    let cancelled = false;
    Promise.all(
      ids.map(async (id) => {
        const n = await getNote(id).catch(() => null);
        return n ? { id, title: n.title || "Source note" } : null;
      }),
    ).then((rows) => {
      if (!cancelled) setSources(rows.filter((r): r is { id: string; title: string } => !!r));
    });
    return () => {
      cancelled = true;
    };
  }, [item?.source_note_ids]);

  if (item === undefined) {
    return (
      <div className="flex justify-center py-20">
        <ShoppingBag className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="py-20 text-center text-ink-soft">
        <p className="font-medium text-ink">This product isn’t in your wishlist.</p>
        <Link to="/wishlist" className="mt-2 inline-block text-sm text-product hover:underline">
          Back to wishlist
        </Link>
      </div>
    );
  }

  const bought = item.wish_status === "purchased";
  const saved = item.wish_status === "saved";
  const favorite = !!item.favorite;
  const dealMet =
    item.target_price != null &&
    item.price_amount != null &&
    item.price_amount <= item.target_price;

  const toggleBought = () =>
    updateWishItem(item.id, { wish_status: bought ? "to_buy" : "purchased" }).catch(() => {});
  const addToWishlist = () => updateWishItem(item.id, { wish_status: "to_buy" }).catch(() => {});
  const toggleFavorite = () =>
    updateWishItem(item.id, { favorite: !favorite }).catch(() => {});
  const saveTarget = () => {
    const n = targetDraft.trim() === "" ? null : Number(targetDraft);
    if (n != null && (Number.isNaN(n) || n < 0)) return;
    updateWishItem(item.id, { target_price: n }).catch(() => {});
  };
  const remove = async () => {
    setDeleting(true);
    try {
      await deleteWishItem(item.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-6 sm:flex-row">
        {/* Image */}
        <div className="mx-auto w-44 shrink-0 sm:mx-0 sm:w-56">
          <div className={`aspect-square overflow-hidden rounded-2xl ${PRODUCT.soft}`}>
            {item.image_url ? (
              <img
                src={item.image_url}
                alt={item.title}
                className="h-full w-full object-contain p-4"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <ShoppingBag className="h-1/4 w-1/4 text-product/50" />
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="min-w-0 flex-1">
          {item.brand && <p className="text-sm font-medium text-product">{item.brand}</p>}
          <h1 className="mt-1 font-serif text-2xl text-ink sm:text-3xl">{item.title}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {item.price_raw && (
              <span className="text-xl font-semibold text-ink">{item.price_raw}</span>
            )}
            {item.rating ? (
              <span className="inline-flex items-center gap-1 text-sm text-ink-soft">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                {item.rating}/5
              </span>
            ) : null}
            {dealMet && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">
                <Tag className="h-3 w-3" />
                Below your target
              </span>
            )}
          </div>

          {/* Buy link */}
          {item.buy_url && (
            <a
              href={item.buy_url}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-4 inline-flex items-center gap-1.5 rounded-full bg-product px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 ${FOCUS_RING}`}
            >
              <ExternalLink className="h-4 w-4" />
              View on {item.domain ?? "store"}
            </a>
          )}

          {/* Your status */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {saved && (
              <button
                type="button"
                onClick={addToWishlist}
                className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-product-soft ${FOCUS_RING}`}
              >
                <Plus className="h-4 w-4" />
                Add to wishlist
              </button>
            )}
            <button
              type="button"
              onClick={toggleBought}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                bought
                  ? "border-transparent bg-product text-white"
                  : "border-border bg-card text-ink hover:bg-product-soft"
              }`}
            >
              {bought ? <Check className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
              {bought ? "Bought" : "Mark bought"}
            </button>
            {/* Favorite — cross-cutting ⭐ flag, independent of bucket */}
            <button
              type="button"
              onClick={toggleFavorite}
              aria-pressed={favorite}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                favorite
                  ? "border-transparent bg-amber-400 text-white"
                  : "border-border bg-card text-ink hover:bg-product-soft"
              }`}
            >
              <Star className={`h-4 w-4 ${favorite ? "fill-current" : ""}`} />
              Favorite
            </button>
          </div>

          {/* Price target — highlights "below target" now; price-drop alerts land in Phase B. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-sm text-ink-soft" htmlFor="target">
              Notify below
            </label>
            <input
              id="target"
              type="number"
              min={0}
              inputMode="decimal"
              value={targetDraft}
              onChange={(e) => setTargetDraft(e.target.value)}
              onBlur={saveTarget}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              placeholder="target price"
              className={`w-32 rounded-full border border-border bg-card px-3 py-1 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
            />
          </div>
        </div>
      </div>

      {/* Specs */}
      {(item.specs?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Specs</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {item.specs!.map((s) => (
              <div
                key={s.label}
                className="flex justify-between gap-3 border-b border-border/60 py-1.5"
              >
                <dt className="text-sm text-ink-soft">{s.label}</dt>
                <dd className="text-right text-sm text-ink">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Pros / cons */}
      {((item.pros?.length ?? 0) > 0 || (item.cons?.length ?? 0) > 0) && (
        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          {(item.pros?.length ?? 0) > 0 && (
            <div>
              <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
                <ThumbsUp className="h-4 w-4 text-emerald-500" />
                Pros
              </h2>
              <ul className="space-y-1.5">
                {item.pros!.map((p, i) => (
                  <li key={i} className="text-sm text-ink">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(item.cons?.length ?? 0) > 0 && (
            <div>
              <h2 className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft">
                <ThumbsDown className="h-4 w-4 text-red-400" />
                Cons
              </h2>
              <ul className="space-y-1.5">
                {item.cons!.map((c, i) => (
                  <li key={i} className="text-sm text-ink">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Verdict */}
      {item.verdict && (
        <section className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-ink-soft">Verdict</h2>
          <p className="text-sm leading-relaxed text-ink">{item.verdict}</p>
        </section>
      )}

      {/* From your notes */}
      {sources.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">From your notes</h2>
          <div className="space-y-1.5">
            {sources.map((s) => (
              <Link
                key={s.id}
                to="/notes/$noteId"
                params={{ noteId: s.id }}
                className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink transition-colors hover:bg-product-soft ${FOCUS_RING}`}
              >
                <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
                <span className="truncate">{s.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Remove */}
      <section className="mt-10">
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className={`inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-red-500 disabled:opacity-60 ${FOCUS_RING} rounded`}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Remove from wishlist
        </button>
      </section>
    </div>
  );
}
