#!/usr/bin/env node
// Design-token port: oklch() -> sRGB hex/rgb-triplet.
//
// The web app (frontend/src/styles.css) defines its palette as oklch() CSS custom
// properties in a `:root` (light) and a `.dark` (dark) block. React Native cannot parse
// oklch, so this script reads that file, resolves var() aliases, converts every token to
// sRGB, and emits two files:
//
//   src/theme/tokens.ts  — { light, dark } records of "#rrggbb" strings keyed by token name
//                          (for JS that needs a raw colour: splash, StatusBar, native APIs).
//   src/global.css       — the @tailwind directives + `:root`/`.dark` blocks of CSS custom
//                          properties as *space-separated rgb triplets* ("253 248 240"), so
//                          tailwind.config.js can reference them as
//                          `rgb(var(--color-x) / <alpha-value>)` and keep Tailwind opacity
//                          modifiers working (bg-recipe-soft/40, ring-recipe/30). NativeWind 4
//                          resolves these custom properties and flips :root/.dark via the
//                          `dark` class driven by colorScheme.
//
// Run:  node scripts/convert-tokens.mjs   (prints a sanity table of known conversions)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = join(HERE, "..");
const STYLES_CSS = join(MOBILE_ROOT, "..", "frontend", "src", "styles.css");
const OUT_TOKENS = join(MOBILE_ROOT, "src", "theme", "tokens.ts");
const OUT_GLOBAL = join(MOBILE_ROOT, "src", "global.css");

// --- oklch -> sRGB -----------------------------------------------------------
// Standard OKLab -> LMS -> linear-sRGB -> gamma pipeline. Out-of-gamut results are
// clamped per-channel to [0, 1] (the naive gamut clip; good enough for these tokens,
// which sit comfortably inside sRGB).

function srgbGamma(x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// oklch(L C H): L in [0,1], C chroma, H hue in degrees. Returns [r,g,b] in [0,255].
function oklchToRgb255(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [rLin, gLin, bLin].map((c) => {
    const v = srgbGamma(c);
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
}

// Alpha composite `src` (with alpha a in [0,1]) over opaque `bg`, both [r,g,b] 0-255.
function over(src, bg, a) {
  return src.map((c, i) => Math.round(a * c + (1 - a) * bg[i]));
}

function toHex([r, g, b]) {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

const toTriplet = ([r, g, b]) => `${r} ${g} ${b}`;

// --- styles.css parsing ------------------------------------------------------

// Extract the body of a top-level `<selector> { ... }` rule via brace matching. `@theme
// inline { ... }` (which also holds `--color-*: var(--*)` lines) is deliberately skipped —
// we only want the raw token blocks `:root` and `.dark`.
function extractBlock(css, selector) {
  // Find the occurrence of `selector` that is a real rule head — immediately followed
  // (past whitespace) by `{`. Skips false hits like `.dark *` inside `@custom-variant`.
  let openIdx = -1;
  let from = 0;
  while (true) {
    const at = css.indexOf(selector, from);
    if (at === -1) break;
    let j = at + selector.length;
    while (j < css.length && /\s/.test(css[j])) j++;
    if (css[j] === "{") {
      openIdx = j;
      break;
    }
    from = at + selector.length;
  }
  if (openIdx === -1) throw new Error(`selector not found as a rule head: ${selector}`);
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(openIdx + 1, i);
    }
  }
  throw new Error(`unbalanced braces for ${selector}`);
}

// name -> raw value string ("oklch(...)", "var(--x)", "1rem", ...).
function parseDecls(block) {
  const map = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block))) map[m[1]] = m[2].trim();
  return map;
}

const VAR_RE = /^var\(--([\w-]+)\)$/;
const OKLCH_RE = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/;

// Resolve a token to [r,g,b] 0-255 for a given mode's declaration map, following var()
// aliases and compositing any alpha over that mode's `--paper`. Returns null for
// non-colour values (e.g. radius).
function resolveColor(name, decls, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const raw = decls[name];
  if (raw == null) return null;

  const varMatch = raw.match(VAR_RE);
  if (varMatch) return resolveColor(varMatch[1], decls, seen);

  const ok = raw.match(OKLCH_RE);
  if (!ok) return null; // not a colour (radius, etc.)

  const L = parseFloat(ok[1]);
  const C = parseFloat(ok[2]);
  const H = parseFloat(ok[3]);
  let rgb = oklchToRgb255(L, C, H);

  if (ok[4] != null) {
    const a = ok[5] === "%" ? parseFloat(ok[4]) / 100 : parseFloat(ok[4]);
    // Composite over the mode's paper so a solid triplet still reads like the intended
    // translucent tint (dark-mode border/input are white-at-10% over near-black paper).
    const paper = resolveColor("paper", decls, new Set());
    rgb = over(rgb, paper ?? [0, 0, 0], a);
  }
  return rgb;
}

function buildMode(block) {
  const decls = parseDecls(block);
  const hex = {};
  const triplet = {};
  for (const name of Object.keys(decls)) {
    const rgb = resolveColor(name, decls);
    if (!rgb) continue; // skip radius & other non-colours
    hex[name] = toHex(rgb);
    triplet[name] = toTriplet(rgb);
  }
  return { hex, triplet };
}

// --- run ---------------------------------------------------------------------

const css = readFileSync(STYLES_CSS, "utf8");
const light = buildMode(extractBlock(css, ":root"));
const dark = buildMode(extractBlock(css, ".dark"));

// Union of token names across both modes (both blocks define the same set today; the
// fallback keeps us safe if that ever drifts).
const names = [...new Set([...Object.keys(light.hex), ...Object.keys(dark.hex)])].sort();

function tokensTs() {
  const rec = (mode) =>
    names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(mode.hex[n] ?? light.hex[n])},`).join("\n");
  return `// AUTO-GENERATED by scripts/convert-tokens.mjs — do not edit by hand.
// oklch() design tokens from frontend/src/styles.css, converted to sRGB hex.
// For JS that needs a raw colour value (splash, StatusBar, native APIs); component
// styling goes through NativeWind classNames wired to the CSS variables in global.css.

export type TokenName = keyof typeof light;

export const light = {
${rec(light)}
} as const;

export const dark: Record<TokenName, string> = {
${rec(dark)}
};
`;
}

function globalCss() {
  const vars = (mode) => names.map((n) => `  --color-${n}: ${mode.triplet[n] ?? light.triplet[n]};`).join("\n");
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

/* AUTO-GENERATED design tokens by scripts/convert-tokens.mjs — do not edit by hand.
   oklch() from frontend/src/styles.css, converted to space-separated sRGB triplets so
   tailwind.config.js can reference them as \`rgb(var(--color-x) / <alpha-value>)\` and
   keep opacity modifiers working (bg-recipe-soft/40, ring-recipe/30). NativeWind flips
   :root -> .dark via the \`dark\` class driven by colorScheme. */
:root {
${vars(light)}
}

.dark {
${vars(dark)}
}
`;
}

mkdirSync(dirname(OUT_TOKENS), { recursive: true });
writeFileSync(OUT_TOKENS, tokensTs());
writeFileSync(OUT_GLOBAL, globalCss());

// --- sanity table ------------------------------------------------------------

const checks = [
  { label: "oklch(1 0 0)", args: [1, 0, 0], expect: "#ffffff" },
  { label: "oklch(0 0 0)", args: [0, 0, 0], expect: "#000000" },
  { label: "oklch(0.5 0 0)", args: [0.5, 0, 0], expect: "#636363" }, // mid grey (neutral L=0.5)
  { label: "paper (light)", args: [0.98, 0.012, 80], expect: "#fdf8f0" },
  { label: "paper (dark)", args: [0.14, 0, 0], expect: "#090909" },
];

console.log(`\nParsed ${names.length} colour tokens from ${STYLES_CSS}`);
console.log(`Wrote ${OUT_TOKENS}`);
console.log(`Wrote ${OUT_GLOBAL}\n`);
console.log("Sanity check (oklch -> hex):");
console.log("  token                 got        expect     ok");
for (const c of checks) {
  const got = toHex(oklchToRgb255(...c.args));
  const ok = got.toLowerCase() === c.expect.toLowerCase() ? "yes" : "NO";
  console.log(`  ${c.label.padEnd(20)}  ${got}    ${c.expect}    ${ok}`);
}
console.log(
  `\nSample emitted tokens: paper=${light.hex.paper}/${dark.hex.paper}  recipe=${light.hex.recipe}/${dark.hex.recipe}  trip=${light.hex.trip}/${dark.hex.trip}\n`,
);
