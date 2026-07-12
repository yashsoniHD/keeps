// Shared interaction primitives for the warm paper/ink house style.
//
// Conventions this file is the source of truth for:
//   - Cards & tiles are rounded-2xl, shadow-sm resting → shadow-md on hover. NoteCard alone
//     may go further (hover:shadow-lg + lift) — it's the hero surface of the feed.
//   - Overlays/sheets are rounded-3xl with shadow-2xl.
//   - Every tappable surface pairs `press` (tactile scale, reduced-motion-safe) with
//     FOCUS_RING so keyboard focus is always visible.

// Focus-visible ring for keyboard users — appended to interactive controls that otherwise
// only style :hover. `--ring` is a warm dark tan tuned to stay visible on paper.
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Tactile press on tappable cards/tiles (the `.press` utility in styles.css; disabled under
// prefers-reduced-motion). Pair with FOCUS_RING.
export const PRESS = "press";

// A tappable card/tile: house surface + hover lift + press + keyboard ring.
export const TILE = `press ${FOCUS_RING} rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md`;

// Tap-target expanders. A small control (icon circle 28–32px) is below the 44px minimum touch
// target, so we grow the *hit area* with a transparent `::before` overlay without touching the
// visible size. The pseudo needs a positioned host: absolute buttons are already positioned;
// static buttons pair these with `relative` (the STACK/ROW variants include it).
export const HIT_44 = "before:absolute before:-inset-1.5 before:content-['']"; // 32px → 44px
export const HIT_44_SM = "before:absolute before:-inset-2 before:content-['']"; // 28px → 44px
// Vertically-stacked pair (gap-1.5): each grows toward its outer edge and meets the sibling
// exactly at the gap midline, so the two 44px hit areas never overlap.
export const HIT_44_STACK_TOP =
  "relative before:absolute before:content-[''] before:-inset-x-1.5 before:-top-[9px] before:-bottom-[3px]";
export const HIT_44_STACK_BOTTOM =
  "relative before:absolute before:content-[''] before:-inset-x-1.5 before:-top-[3px] before:-bottom-[9px]";
// Horizontal header row (gap-2): full 44px tall, 40px wide (grows 4px per side to the gap
// midline) so neighbouring icon buttons don't overlap.
export const HIT_44_ROW =
  "relative before:absolute before:content-[''] before:-inset-y-1.5 before:-inset-x-1";
