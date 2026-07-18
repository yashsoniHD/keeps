const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// Single source of truth for colour names: the CSS custom properties emitted into
// src/global.css by scripts/convert-tokens.mjs. Each `--color-<name>` becomes a Tailwind
// colour keyed by `<name>`, referencing the variable as `rgb(var(--color-<name>) /
// <alpha-value>)` so Tailwind opacity modifiers (bg-recipe-soft/40, ring-recipe/30) work
// and NativeWind can flip light -> dark via the `dark` class (colorScheme).
const css = readFileSync(join(__dirname, "src", "global.css"), "utf8");
const tokenNames = [...new Set([...css.matchAll(/--color-([\w-]+)\s*:/g)].map((m) => m[1]))];
const colors = Object.fromEntries(
  tokenNames.map((name) => [name, `rgb(var(--color-${name}) / <alpha-value>)`]),
);

// Brand typography parity with the web app (frontend/src/styles.css):
//   --font-sans:  "Inter"            -> font-sans / default body text
//   --font-serif: "Instrument Serif" -> font-serif (wordmark, note titles, section headings)
// React Native ignores `fontWeight` for custom fonts — each weight is a *separate* registered
// family (Inter_500Medium, Inter_600SemiBold, ...). So the Tailwind weight utilities
// (font-medium / font-semibold / font-bold) can't just set fontWeight; they must also point at
// the matching family. We do that centrally here (rather than editing every `<Text>` call site):
// the core `fontWeight` plugin is disabled and the weight utilities are re-defined below to carry
// BOTH the family and the numeric weight. This keeps every existing `font-medium`/`font-semibold`/
// `font-bold` class working with real Inter — no project-wide class swap, and nothing to change in
// files owned by other agents. Instrument Serif ships only at 400, and `font-serif` is never
// combined with a weight class in this codebase, so there is no serif/weight collision.
const plugin = require("tailwindcss/plugin");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  // Disable the stock fontWeight utilities so our family-aware versions (below) are the only
  // `.font-<weight>` rules — no cascade ambiguity over which definition wins.
  corePlugins: { fontWeight: false },
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: ["Inter_400Regular"],
        serif: ["InstrumentSerif_400Regular"],
        // Explicit family escape hatches, should a call site want a weight via `font-*` family.
        "sans-medium": ["Inter_500Medium"],
        "sans-semibold": ["Inter_600SemiBold"],
        "sans-bold": ["Inter_700Bold"],
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      addUtilities({
        ".font-normal": { fontFamily: "Inter_400Regular", fontWeight: "400" },
        ".font-medium": { fontFamily: "Inter_500Medium", fontWeight: "500" },
        ".font-semibold": { fontFamily: "Inter_600SemiBold", fontWeight: "600" },
        ".font-bold": { fontFamily: "Inter_700Bold", fontWeight: "700" },
      });
    }),
  ],
};
