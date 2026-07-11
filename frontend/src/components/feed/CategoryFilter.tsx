import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutGrid } from "lucide-react";
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

// Top-bar button that opens the Collections page — the five mini-apps plus the user's own
// smart collections. Now a real route (/collections) rather than a full-screen overlay, so
// mini-app back buttons have somewhere to return to.
export function CollectionsMenu() {
  return (
    <Link
      to="/collections"
      aria-label="Open collections"
      title="Collections"
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
    >
      <LayoutGrid className="h-4 w-4" />
    </Link>
  );
}
