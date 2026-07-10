import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, LayoutGrid, X } from "lucide-react";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
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

// Top-bar button that opens the full-screen categories page. The button reflects the active
// filter (its icon + accent) so the applied category is legible from the header.
export function CategoryMenu({
  categories,
  active,
  setActive,
  counts,
}: {
  categories: string[];
  active: string;
  setActive: (v: string) => void;
  counts?: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const isFiltered = active !== "all";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={isFiltered ? `Category: ${noteLabel(active)}` : "Browse categories"}
        title={isFiltered ? `Category: ${noteLabel(active)}` : "Browse categories"}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
          isFiltered
            ? "border-ink bg-card text-ink"
            : "border-border bg-card text-ink-soft hover:text-ink"
        }`}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>

      {open && (
        <CategoryPage
          categories={categories}
          active={active}
          counts={counts}
          onPick={(v) => {
            setActive(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Full-screen categories page: every category as a colour-coded tile in a 2-column grid, each
// tile tinted with its category accent. Portaled to <body> to escape the header backdrop.
function CategoryPage({
  categories,
  active,
  counts,
  onPick,
  onClose,
}: {
  categories: string[];
  active: string;
  counts?: Record<string, number>;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
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

  const total = useMemo(
    () => (counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined),
    [counts],
  );

  const Tile = ({
    slug,
    label,
    count,
    icon,
    tint,
    isActive,
  }: {
    slug: string;
    label: string;
    count?: number;
    icon: React.ReactNode;
    tint: string;
    isActive: boolean;
  }) => (
    <button
      key={slug}
      type="button"
      onClick={() => onPick(slug)}
      className={`flex min-h-[104px] flex-col justify-between gap-6 rounded-2xl p-4 text-left transition-transform active:scale-[0.98] ${FOCUS_RING} ${tint}`}
    >
      <div className="flex items-start justify-between">
        {icon}
        {isActive && <Check className="h-5 w-5 shrink-0" />}
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold">{label}</div>
        {count != null && (
          <div className="text-sm opacity-70">
            {count} {count === 1 ? "note" : "notes"}
          </div>
        )}
      </div>
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-background duration-150 animate-in fade-in-0">
      <div className="shrink-0 border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <h1 className="font-serif text-2xl text-ink">Categories</h1>
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
            <Tile
              slug="all"
              label="All notes"
              count={total}
              tint={active === "all" ? "bg-ink text-paper" : "bg-ink/[0.04] text-ink"}
              icon={<LayoutGrid className="h-6 w-6" />}
              isActive={active === "all"}
            />
            {categories.map((c) => {
              const Icon = noteIcon(c);
              const accent = noteAccent(c);
              const isActive = active === c;
              return (
                <Tile
                  key={c}
                  slug={c}
                  label={noteLabel(c)}
                  count={counts?.[c]}
                  tint={isActive ? `${accent.dot} text-white` : accent.chip}
                  icon={<Icon className="h-6 w-6" />}
                  isActive={isActive}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
