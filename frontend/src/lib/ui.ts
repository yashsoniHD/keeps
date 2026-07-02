// Shared focus-visible ring for keyboard users — appended to interactive controls that
// otherwise only style :hover (custom buttons and card links don't get a ring for free).
// `--ring` is the cobalt brand hue, so focus reads as the Signal accent.
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// The Signal signature interaction: a springy press on tappable cards/tiles (defined as the
// `.press` utility in styles.css; disabled under prefers-reduced-motion). Pair with FOCUS_RING.
export const PRESS = "press";

// A tappable card/tile: chunky surface + hover lift + springy press + keyboard ring. The one
// class to reach for when building a Signal tile.
export const TILE = `press ${FOCUS_RING} rounded-3xl border border-border bg-card transition-shadow hover:shadow-lg hover:shadow-black/5`;
