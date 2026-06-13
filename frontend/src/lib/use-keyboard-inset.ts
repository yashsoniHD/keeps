import { useEffect, useRef } from "react";

// Pins a bottom-anchored bar just above the iOS software keyboard and keeps it
// there while the page scrolls. iOS Safari has two separate quirks the bar must
// survive:
//   1. Opening the keyboard shrinks only the *visual* viewport, not the layout
//      viewport, so a `position: fixed; bottom: 0` bar ends up behind the keyboard.
//   2. While the keyboard is open, fixed bars drift with the page during momentum
//      scroll instead of staying put (a long-standing WebKit bug).
// Both are handled by re-pinning the element's bottom to the visual viewport's
// visible bottom on every resize *and* scroll. The write is imperative (direct
// style mutation inside rAF), not React state — that's what keeps it lag-free, so
// the bar neither bounces (1st attempt) nor scrolls away (2nd attempt).
//
// Returns a ref to attach to the bar. No-ops where `visualViewport` is absent
// (desktop), where plain CSS `bottom: 0` already does the right thing. Pass
// `active=false` while the bar is unmounted so the listeners aren't wired up to a
// stale node.
export function useKeyboardPin<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    let raf = 0;
    const reposition = () => {
      // Distance from the layout-viewport bottom (where `bottom: 0` lands) up to
      // the visible bottom of the visual viewport (the top edge of the keyboard).
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      el.style.transform = gap > 1 ? `translate3d(0, ${-gap}px, 0)` : "";
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reposition);
    };

    reposition();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      cancelAnimationFrame(raf);
      el.style.transform = "";
    };
  }, [active]);

  return ref;
}
