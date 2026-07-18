// Raw accent/token colours for surfaces that can't take a NativeWind className — lucide
// icons (want a `color` prop, not `stroke: currentColor`) and react-native-svg fills. Views and
// Text still style through `noteAccent(...)` classNames; this only fills the gaps.
//
// The palette order MUST match note-meta.tsx PALETTES so a raw accent colour lines up with the
// className accent for the same content type.
import { paletteIndexFor } from "@clipnote/shared";
import { useTheme } from "@/theme/ThemeProvider";
import { light, dark, type TokenName } from "@/theme/tokens";

const PALETTE_BASES = [
  "recipe",
  "place",
  "product",
  "summary",
  "media",
  "tech",
  "business",
  "health",
  "trip",
] as const;

// The raw token map for the resolved (light/dark) scheme.
export function useTokens(): Record<TokenName, string> {
  const { resolved } = useTheme();
  return resolved === "dark" ? dark : light;
}

export interface AccentColors {
  main: string;
  soft: string;
  chip: string;
  on: string;
}

// Raw accent colours for a note's content type, resolved for the current scheme.
export function useAccentColors(contentType: string): AccentColors {
  const t = useTokens();
  const base = PALETTE_BASES[paletteIndexFor(contentType) % PALETTE_BASES.length];
  return {
    main: t[base as TokenName],
    soft: t[`${base}-soft` as TokenName],
    chip: t[`${base}-chip` as TokenName],
    on: t[`${base}-on` as TokenName],
  };
}
