// The Clipnote mark — a paper clip drawn as one continuous stroke (brand kit: "the paper-clip
// identity"). One path, `currentColor`, round caps, so it inherits size + color from its box and
// works ink-on-paper, paper-on-ink, or terracotta. `animate` runs the signature draw-on reveal
// (splash / loading) via the `.clip-draw` keyframe in styles.css.

// The single clip path, shared by the mark and its animated variants so the geometry never drifts.
const CLIP_PATH = "M20 31V17a6 6 0 0 1 12 0V33a8 8 0 0 1-16 0V15a10 10 0 0 1 20 0V28";

export function ClipMark({
  className,
  animate = false,
  strokeWidth = 3,
}: {
  className?: string;
  animate?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden className={className}>
      <path
        pathLength={100}
        d={CLIP_PATH}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        className={animate ? "clip-draw" : undefined}
      />
    </svg>
  );
}

// Loading spinner in the brand's terracotta: a bright segment of "light" travels endlessly around
// the clip (`.clip-march`) over a faint full-clip ghost. Sizes/colors off its box like ClipMark;
// defaults to terracotta so it reads as the brand accent wherever it's dropped.
export function ClipLoader({
  className,
  strokeWidth = 3,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <span className={`inline-block text-recipe ${className ?? ""}`} role="status" aria-label="Loading">
      <svg viewBox="0 0 48 48" fill="none" aria-hidden className="block h-full w-full">
        {/* faint ghost of the whole clip */}
        <path
          d={CLIP_PATH}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={0.2}
        />
        {/* the travelling light */}
        <path
          pathLength={100}
          d={CLIP_PATH}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="clip-march"
        />
      </svg>
    </span>
  );
}

// The "saving" motion for a freshly-captured note: a terracotta clip drops from above and snaps
// onto a little note card, then lifts off and repeats (`.clip-snap`). Drawn at the brand's native
// 78×96 proportions; `scale` fits it to a grid tile (1) or a condensed row (~0.46).
export function SaveSnap({ scale = 1, className }: { scale?: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ width: 78 * scale, height: 96 * scale }}
      aria-hidden
    >
      <div
        className="relative"
        style={{ width: 78, height: 96, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {/* note card */}
        <div
          className="absolute inset-0 rounded-[10px] border border-border bg-card"
          style={{ top: 14, boxShadow: "0 6px 14px -10px oklch(0.2 0.02 60 / 0.5)" }}
        />
        {/* two ruled lines */}
        <div className="absolute h-0.5 bg-border" style={{ left: 16, right: 16, top: 34 }} />
        <div className="absolute h-0.5 w-3/5 bg-border" style={{ left: 16, top: 44 }} />
        {/* the snapping clip */}
        <span
          className="clip-snap absolute text-recipe"
          style={{ left: 8, top: -6, width: 34, height: 34 }}
        >
          <svg viewBox="0 0 48 48" fill="none" aria-hidden className="block h-full w-full">
            <path
              d={CLIP_PATH}
              stroke="currentColor"
              strokeWidth={3.4}
              strokeLinecap="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}
