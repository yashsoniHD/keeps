import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { noteAccent, noteIcon } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";

// Tracks whether a horizontal scroller sits at its start/end (for the edge fades) and whether
// it overflows at all (`hasOverflow`, independent of current scroll position — used to show the
// "all categories" overflow button only when chips actually don't all fit). Recomputes on
// scroll, on resize, and when `deps` change (e.g. the category list grows — which changes
// scrollWidth, not box size).
function useScrollEdges<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true, hasOverflow: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setEdges({
        atStart: scrollLeft <= 1,
        atEnd: scrollLeft + clientWidth >= scrollWidth - 1,
        hasOverflow: scrollWidth > clientWidth + 1,
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

// One chip: a display label plus every slug that renders to it (e.g. "Trips" carries both
// `itinerary` and `trip`). Selecting it filters the feed to ANY of its slugs.
export type ChipGroup = { label: string; slugs: string[] };

// The quick-filter row under the header: a horizontally-scrolling strip of category chips with
// edge fades, plus a pinned overflow button (outside the scroller, so it never scrolls away)
// that lists every category at once for when the row doesn't all fit. Chips are deduped by
// display label — one chip per label, carrying all slugs that map to it — so `itinerary`/`trip`
// don't show as two "Trips" chips that each filter a different subset.
export function CategoryChips({
  groups,
  active,
  setActive,
}: {
  groups: ChipGroup[];
  active: string;
  setActive: (v: string) => void;
}) {
  const { ref, atStart, atEnd, hasOverflow } = useScrollEdges<HTMLDivElement>([groups.length]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
          {groups.map((g) => {
            // Style/icon come from the group's representative (first) slug; selecting it sets
            // that slug as `active`, and a chip reads active when `active` is any of its slugs
            // (so a deep link to any one slug still lights the right chip).
            const rep = g.slugs[0];
            const accent = noteAccent(rep);
            const Icon = noteIcon(rep);
            const isActive = g.slugs.includes(active);
            return (
              <button
                key={g.label}
                type="button"
                onClick={() => setActive(rep)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${FOCUS_RING} ${
                  isActive ? `${accent.dot} ${accent.on}` : accent.chip
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {g.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Only shown when the row actually overflows (real scrollWidth > clientWidth, not just
          "more than N groups") — the simpler count-based heuristic would either show it too
          eagerly on narrow phones or hide it on wide desktop windows with many categories. */}
      {hasOverflow && (
        <CategoryOverflowButton groups={groups} active={active} setActive={setActive} />
      )}
    </div>
  );
}

// Pinned button at the end of the chip row: opens a popover listing every category vertically
// (icon + label), so a chip that has scrolled out of view is still one tap away. Reuses the
// exact same select logic as an inline chip (`setActive("all")` / `setActive(rep)`), so picking
// an entry here filters identically to tapping its chip.
function CategoryOverflowButton({
  groups,
  active,
  setActive,
}: {
  groups: ChipGroup[];
  active: string;
  setActive: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, [open]);

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="All categories"
        title="All categories"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
          active !== "all"
            ? "border-ink bg-card text-ink"
            : "border-border bg-card text-ink-soft hover:text-ink"
        }`}
      >
        <ChevronDown className="h-4 w-4" />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            {/* Outside-tap catcher at <body> root: closes the menu and swallows the tap, so it
                never falls through to a note card behind it (same pattern as LayoutToggle). */}
            <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => setOpen(false)} />
            <div
              role="listbox"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-[61] max-h-80 w-56 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 shadow-2xl"
            >
              <button
                type="button"
                role="option"
                aria-selected={active === "all"}
                onClick={() => {
                  setActive("all");
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                  active === "all"
                    ? "bg-ink/5 text-ink"
                    : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                }`}
              >
                <span className="flex-1">All</span>
                {active === "all" && <Check className="h-4 w-4 shrink-0 text-ink" />}
              </button>
              {groups.map((g) => {
                const rep = g.slugs[0];
                const Icon = noteIcon(rep);
                const isActive = g.slugs.includes(active);
                return (
                  <button
                    key={g.label}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      setActive(rep);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                      isActive ? "bg-ink/5 text-ink" : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{g.label}</span>
                    {isActive && <Check className="h-4 w-4 shrink-0 text-ink" />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
