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
