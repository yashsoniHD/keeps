// Bridges a NoteAccent (NativeWind class strings from note-meta) to the raw hex a solid,
// full-screen story slide needs. The web WrappedStories paints each slide with its accent's
// `dot` fill (`bg-recipe`, …) and its WCAG-safe `on` text colour (`text-recipe-on`, …); on RN
// we can't lean on those utility classes for a dynamically-chosen animated surface, so we
// resolve them to the same tokens by hand.
import type { NoteAccent } from "@/lib/note-meta";
import { dark, light } from "@/theme/tokens";

export type SlideColors = { bg: string; on: string };

// `accent.dot` is always `bg-{base}` (recipe/place/product/summary/media/tech/business/health);
// the solid fill is token `{base}` and its text is token `{base}-on` — the exact pair the web
// classes point at, so the palette rotation matches web slide-for-slide.
export function slideColors(accent: NoteAccent, isDark: boolean): SlideColors {
  const tokens = (isDark ? dark : light) as Record<string, string>;
  const base = accent.dot.replace(/^bg-/, "");
  return {
    bg: tokens[base] ?? tokens.summary,
    on: tokens[`${base}-on`] ?? tokens["summary-on"],
  };
}

// The soft inset used for chips/cards on a solid slide. Web uses a flat `bg-black/10` on every
// accent (it reads on both light- and dark-`on` fills), so we mirror that rather than tint per
// accent. `pressed` is the tap-feedback equivalent of web's `hover:bg-black/20`.
export function chipFill(pressed = false): string {
  return pressed ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.1)";
}

// "2026-07-08" → "8 Jul". Parsed from local parts (not `new Date(iso)`) so the day never drifts
// across a timezone boundary — same guard the web helper uses.
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
