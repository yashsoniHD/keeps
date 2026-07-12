// WCAG contrast auditor for the design-system accent tokens.
//
// Reads the OKLCH tokens straight out of src/styles.css (:root = light, .dark = dark),
// resolves var() aliases, converts OKLCH -> OKLab -> linear sRGB (Ottosson's matrices),
// then reports the WCAG 2.x contrast ratio for every foreground/background pair the UI
// actually renders:
//   - fill pair:  text-{x}-on  on  bg-{x}         (solid accent buttons/badges)
//   - chip pair:  text-{x}     on  bg-{x}-soft    (soft chips)
// Threshold is 4.5:1 (normal text). No dependencies.
//
// Usage: node scripts/contrast-check.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, "..", "src", "styles.css"), "utf8");

const THRESHOLD = 4.5;
const LARGE = 3.0;

// The accents in scope: 9 domain accents + 2 semantic accents.
const ACCENTS = [
  "recipe",
  "place",
  "product",
  "summary",
  "media",
  "tech",
  "business",
  "health",
  "trip",
  "favorite",
  "success",
];

// --- token extraction ---------------------------------------------------------

// Pull the top-level `:root { ... }` and `.dark { ... }` declaration blocks.
function block(selector) {
  const re = new RegExp(`${selector}\\s*\\{`, "g");
  const m = re.exec(CSS);
  if (!m) throw new Error(`selector ${selector} not found`);
  let i = re.lastIndex;
  let depth = 1;
  const start = i;
  for (; i < CSS.length && depth > 0; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") depth--;
  }
  return CSS.slice(start, i - 1);
}

// Parse `--name: value;` declarations into a map (last write wins).
function parseVars(text) {
  const vars = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(text))) vars[m[1]] = m[2].trim();
  return vars;
}

// Resolve `var(--x)` chains to a concrete color string.
function resolve(vars, value, seen = new Set()) {
  const m = /^var\(\s*--([\w-]+)\s*\)$/.exec(value.trim());
  if (!m) return value.trim();
  const name = m[1];
  if (seen.has(name)) throw new Error(`var cycle at --${name}`);
  seen.add(name);
  if (!(name in vars)) throw new Error(`unresolved var --${name}`);
  return resolve(vars, vars[name], seen);
}

// --- color math ---------------------------------------------------------------

// Parse `oklch(L C H)` / `oklch(L C H / A)`. L may be a 0..1 number or a percentage.
function parseOklch(str) {
  const m = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/.exec(str);
  if (!m) throw new Error(`not an oklch() color: ${str}`);
  let L = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  return { L, C, H };
}

// OKLCH -> linear sRGB (Ottosson). Returns linear R,G,B (may be out of [0,1]).
function oklchToLinear({ L, C, H }) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

// linear channel -> gamma-encoded sRGB, clamped to a real, displayable [0,1] value.
function encode(c) {
  c = Math.min(1, Math.max(0, c));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

// gamma sRGB -> linear (for WCAG luminance).
function decode(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// WCAG relative luminance of an oklch color, via clamp-to-gamut round trip.
function luminance(oklch) {
  const lin = oklchToLinear(oklch);
  const R = decode(encode(lin.r));
  const G = decode(encode(lin.g));
  const B = decode(encode(lin.b));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// --- report -------------------------------------------------------------------

function auditMode(name, vars) {
  const get = (token) => parseOklch(resolve(vars, vars[token]));
  const rows = [];
  let worst = Infinity;
  for (const x of ACCENTS) {
    // fill pair: text-{x}-on on bg-{x}
    const fill = contrast(get(`${x}-on`), get(x));
    // chip pair: text-{x}-chip on bg-{x}-soft
    const chip = contrast(get(`${x}-chip`), get(`${x}-soft`));
    worst = Math.min(worst, fill, chip);
    rows.push({ x, fill, chip });
  }
  console.log(`\n${name.toUpperCase()} MODE`);
  console.log(
    "accent".padEnd(10) +
      "fill (on/base)".padEnd(18) +
      "chip (text/soft)".padEnd(20),
  );
  for (const r of rows) {
    const f = `${r.fill.toFixed(2)} ${r.fill >= THRESHOLD ? "PASS" : r.fill >= LARGE ? "lg" : "FAIL"}`;
    const c = `${r.chip.toFixed(2)} ${r.chip >= THRESHOLD ? "PASS" : r.chip >= LARGE ? "lg" : "FAIL"}`;
    console.log(r.x.padEnd(10) + f.padEnd(18) + c.padEnd(20));
  }
  return worst;
}

const light = parseVars(block(":root"));
const dark = parseVars(block("\\.dark"));

const w1 = auditMode("light", light);
const w2 = auditMode("dark", dark);

const worst = Math.min(w1, w2);
console.log(`\nworst pair overall: ${worst.toFixed(2)}`);
if (worst < THRESHOLD) {
  console.log(`FAIL — some pair is below ${THRESHOLD}:1`);
  process.exit(1);
} else {
  console.log(`PASS — every pair >= ${THRESHOLD}:1`);
}
