import Svg, { Path } from "react-native-svg";

// The Clipnote mark, ported from the web app (frontend/src/components/ClipMark.tsx): a paper clip
// drawn as one continuous stroke ("the paper-clip identity"). One path, round caps, inherits its
// colour from `color` so it works ink-on-paper, paper-on-ink, or terracotta. Same viewBox and path
// geometry as web so the two platforms never drift.
const CLIP_PATH = "M20 31V17a6 6 0 0 1 12 0V33a8 8 0 0 1-16 0V15a10 10 0 0 1 20 0V28";

// RN has no `currentColor`; the web SVG uses stroke="currentColor" + text colour. Here `color`
// plays that role (defaults to the brand ink) and callers pass it explicitly per placement.
export function ClipMark({
  size = 32,
  color = "#190f0a",
  strokeWidth = 3,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path
        d={CLIP_PATH}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
