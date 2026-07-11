import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { LayoutGrid, X } from "lucide-react";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import { TOOLS } from "@/lib/collections-meta";
import { FOCUS_RING } from "@/lib/ui";

// Tracks whether a horizontal scroller sits at its start/end, so the caller can show edge
// fades only when content actually overflows. Recomputes on scroll, on resize, and when
// `deps` change (e.g. the category list grows — which changes scrollWidth, not box size).
function useScrollEdges<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setEdges({
        atStart: scrollLeft <= 1,
        atEnd: scrollLeft + clientWidth >= scrollWidth - 1,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, ...edges };
}

// The quick-filter row under the header: a horizontally-scrolling strip of category chips with
// edge fades. For the full taxonomy at once, the top-bar CategoryMenu button opens the page.
export function CategoryChips({
  categories,
  active,
  setActive,
}: {
  categories: string[];
  active: string;
  setActive: (v: string) => void;
}) {
  const { ref, atStart, atEnd } = useScrollEdges<HTMLDivElement>([categories.length]);

  return (
    <div className="min-w-0 flex-1">
      {/* Edge fades via a mask on the scroller itself — fades the actual chips to transparent, so
        it's background-agnostic (no opaque-overlay seam against the translucent, blurred header)
        and only fades the side that actually overflows. */}
      <div
        ref={ref}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          WebkitMaskImage: `linear-gradient(to right, ${atStart ? "black" : "transparent"}, black 28px, black calc(100% - 28px), ${atEnd ? "black" : "transparent"})`,
          maskImage: `linear-gradient(to right, ${atStart ? "black" : "transparent"}, black 28px, black calc(100% - 28px), ${atEnd ? "black" : "transparent"})`,
        }}
      >
        <button
          type="button"
          onClick={() => setActive("all")}
          className={`shrink-0 rounded-full px-4 py-2 text-sm transition-colors ${FOCUS_RING} ${
            active === "all"
              ? "bg-ink text-paper"
              : "border border-border bg-card text-ink-soft hover:text-ink"
          }`}
        >
          All
        </button>
        {categories.map((c) => {
          const accent = noteAccent(c);
          const Icon = noteIcon(c);
          const isActive = active === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setActive(c)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${FOCUS_RING} ${
                isActive ? `${accent.dot} text-white` : accent.chip
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {noteLabel(c)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Top-bar button that opens the full-screen collections launcher — the five mini-apps.
// (Replaces the old category-filter page; note-category filtering lives in CategoryChips.)
export function CollectionsMenu() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open collections"
        title="Collections"
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>

      {open && <CollectionsPage onClose={() => setOpen(false)} />}
    </>
  );
}

// Full-screen collections launcher: the mini-apps (Watchlist, Wishlist, Places, Recipes, Trips)
// as colour-coded tiles, each opening its standalone app. The Notes catch-all is intentionally
// omitted — Notes is the home feed. Portaled to <body> to escape the header backdrop.
function CollectionsPage({ onClose }: { onClose: () => void }) {
  // Close on Escape; lock body scroll while the full-screen page is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const apps = TOOLS.filter((t) => t.app); // drop the Notes catch-all

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-background duration-150 animate-in fade-in-0">
      <div className="shrink-0 border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <h1 className="font-serif text-2xl text-ink">Collections</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-accent hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {apps.map((t) => {
              const Icon = t.icon;
              return (
                <Link
                  key={t.key}
                  to={t.to}
                  onClick={onClose}
                  className={`flex min-h-[120px] flex-col justify-between gap-6 rounded-2xl border p-4 text-left transition-transform active:scale-[0.98] ${FOCUS_RING} ${t.wash}`}
                >
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${t.fill}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className={`truncate font-semibold ${t.text}`}>{t.label}</div>
                    <div className="truncate text-sm text-ink-soft">{t.desc}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
