// Note (raw Firestore doc, per-template `data` shape) -> NoteView (document of blocks).
// Template selection mirrors components/NoteContent.tsx. Must never throw: every template
// mapper runs inside a try, falling back to the generic mapper, then to no blocks.
// Relative imports (not "@/") so the check script runs under plain node.
import type { Note } from "../lib/types.ts";
import { formatDateShort, noteLabel, sourceLabel } from "../lib/note-meta.ts";
import type { Block, BlockLink, NoteView } from "./view.ts";

export type R = Record<string, unknown>;
interface Mapped {
  facts: string[];
  blocks: Block[];
  creator?: string;
  duration?: string;
  thin?: boolean;
}

// ---- tolerant readers -------------------------------------------------------------
export const isRec = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
export const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" && isFinite(v) ? String(v) : "";
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
// Only http(s) URLs survive; model data may carry javascript:/data: links.
export const safeUrl = (v: unknown): string => {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s : "";
};
export const recs = (v: unknown): R[] => arr(v).filter(isRec);
export const join = (parts: unknown[], sep = " · ") => parts.map(str).filter(Boolean).join(sep);
const block = (
  heading: string,
  kind: Block["kind"],
  items: string[],
  extra: Partial<Block> = {},
) => (items.length ? [{ heading, kind, items, ...extra } as Block] : []);
export const humanize = (k: string) => {
  const s = k
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// {text, attribution|timestamp}[] -> pull-quotes; {label, value}[] -> spec rows (templates).
export const parseQuotes = (v: unknown) =>
  recs(v)
    .map((q) => ({ text: str(q.text), by: str(q.attribution) || str(q.timestamp) }))
    .filter((q) => q.text);
export const labelValues = (v: unknown) =>
  recs(v)
    .map((f) => ({ label: str(f.label), value: str(f.value) }))
    .filter((f) => f.label && f.value);
const labelled = (label: string, v: unknown) => (str(v) ? `${label}: ${str(v)}` : "");

// ---- template resolution (mirror of NoteContent.resolveTemplate) ------------------
export function resolveTemplate(note: Note, data: R): string {
  const titles = data.titles;
  if (Array.isArray(titles) && titles.length > 0 && typeof titles[0] === "object")
    return "entertainment";
  if (note.template) return note.template;
  if (Array.isArray(data.ingredients)) return "recipe";
  if (Array.isArray(data.days)) return "itinerary";
  if (Array.isArray(data.exercises) || (data.structure && data.goal)) return "workout";
  if (data.specs || data.pros || data.cons || data.buyUrl || (data.price && data.brand))
    return "product";
  if (data.tldr || Array.isArray(data.keyPoints)) return "summary";
  if (Array.isArray(data.venues)) return "place";
  if (Array.isArray(data.highlights) && (data.location || data.timings)) return "place";
  if (data.premise || data.whoShouldRead || Array.isArray(data.keyIdeas)) return "book";
  return "";
}

// ---- generic mapper (Summary / Book / Generic / unknown / fallback) ---------------
// A few keys have a fixed heading/kind; everything else is inferred from the value's shape.
const KEY_RULES: Record<string, { heading?: string; kind?: Block["kind"] }> = {
  tldr: { heading: "TL;DR" },
  keyPoints: { heading: "Key points" },
  quotes: { heading: "Highlights" },
  actionItems: { heading: "Action items", kind: "checklist" },
  checklist: { kind: "checklist" },
  steps: { kind: "steps" },
  body: { heading: "Note" },
};
const SKIP_KEYS = new Set(["thin", "medium", "videoLength", "author", "creator", "embedding"]);
const SHORT = 40; // scalars up to this length become "At a glance" chips, longer ones text blocks

// One array item / object -> a single display string.
function line(v: unknown): string {
  if (!isRec(v)) return Array.isArray(v) ? join(v.map(line)) : str(v);
  if (Array.isArray(v.cells)) return join(v.cells);
  if (str(v.label) && str(v.value)) return `${str(v.label)}: ${str(v.value)}`;
  if (str(v.text)) {
    const by = str(v.attribution) || str(v.timestamp);
    return by ? `${str(v.text)} (${by})` : str(v.text);
  }
  return join(
    Object.entries(v).map(([k, x]) =>
      isRec(x) || Array.isArray(x) ? "" : labelled(humanize(k), x),
    ),
  );
}

function table(t: R): string[] {
  const cols = strs(t.columns);
  return arr(t.rows)
    .map((row) => {
      const cells = (Array.isArray(row) ? row : isRec(row) ? arr(row.cells) : []).map(str);
      return join(cells.map((c, i) => (c && cols[i] ? `${cols[i]}: ${c}` : c)));
    })
    .filter(Boolean);
}

function generic(data: R): Mapped {
  const out: Mapped = { facts: [], blocks: [] };
  const author = str(data.author) || str(data.creator);
  if (author) out.creator = author;
  out.duration = str(data.videoLength) || undefined;
  for (const [key, v] of Object.entries(data)) {
    if (v == null || SKIP_KEYS.has(key)) continue;
    const rule = KEY_RULES[key] ?? {};
    const heading = rule.heading ?? humanize(key);
    try {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        const s = typeof v === "boolean" ? (v ? "Yes" : "") : str(v);
        if (!s) continue;
        if (s.length <= SHORT && !(key in KEY_RULES)) out.facts.push(`${humanize(key)}: ${s}`);
        else out.blocks.push(...block(heading, "text", [s]));
      } else if (Array.isArray(v)) {
        // {heading, items[]} entries (generic `sections`) become one block each
        if (key === "sections") {
          for (const sec of recs(v))
            out.blocks.push(...block(str(sec.heading), "list", strs(sec.items)));
          continue;
        }
        const items = v.map(line).filter(Boolean);
        if (key === "facts") out.blocks.push(...block("Facts", "facts", items));
        else out.blocks.push(...block(heading, rule.kind ?? "list", items));
      } else if (isRec(v)) {
        const items = Array.isArray(v.columns)
          ? table(v)
          : Object.entries(v)
              .map(([k, x]) => labelled(humanize(k), isRec(x) ? line(x) : x))
              .filter(Boolean);
        out.blocks.push(...block(heading, Array.isArray(v.columns) ? "list" : "facts", items));
      }
    } catch {
      /* one bad key never costs the rest of the note */
    }
  }
  const rt = str(data.readTime);
  if (rt && !out.facts.some((f) => f.startsWith("Read time"))) out.facts.push(`Read time: ${rt}`);
  return out;
}

// ---- per-template mappers ---------------------------------------------------------
function recipe(d: R): Mapped {
  const groups = recs(d.ingredients);
  const count = groups.reduce((n, g) => n + strs(g.items).length, 0);
  const facts = [
    str(d.totalTime),
    labelled("Prep", d.prepTime),
    labelled("Cook", d.cookTime),
    str(d.servings) && `Serves ${str(d.servings)}`,
    count ? `${count} ingredients` : "",
    str(d.difficulty),
    str(d.cuisine),
    str(d.calories),
  ].filter(Boolean) as string[];
  const blocks: Block[] = [];
  for (const g of groups) {
    const name = str(g.group);
    const h = groups.length > 1 && name ? `Ingredients — ${name}` : "Ingredients";
    blocks.push(...block(h, "checklist", strs(g.items)));
  }
  blocks.push(...block("Method", "steps", strs(d.steps)));
  blocks.push(...block("Tips", "text", strs(d.tips)));
  if (isRec(d.nutrition))
    blocks.push(
      ...block(
        "Nutrition",
        "facts",
        Object.entries(d.nutrition)
          .map(([k, v]) => labelled(humanize(k), v))
          .filter(Boolean),
      ),
    );
  return { facts, blocks };
}

function workout(d: R): Mapped {
  const facts = [
    labelled("Goal", d.goal),
    labelled("Level", d.level),
    labelled("Duration", d.duration),
    labelled("Frequency", d.frequency),
  ].filter(Boolean);
  const blocks: Block[] = [];
  blocks.push(...block("Equipment", "facts", strs(d.equipment)));
  blocks.push(...block("Muscles", "facts", strs(d.muscles)));
  for (const s of recs(d.structure))
    blocks.push(...block(str(s.block) || "Structure", "list", strs(s.items)));
  const ex = recs(d.exercises).map((e) => {
    const sr = [str(e.sets), str(e.reps)].filter(Boolean).join(" × ");
    const head = join(
      [str(e.name), sr, str(e.duration), str(e.rest) && `${str(e.rest)} rest`],
      " · ",
    );
    return str(e.formCues) ? `${head} — ${str(e.formCues)}` : head;
  });
  blocks.push(...block("Exercises", "steps", ex.filter(Boolean)));
  blocks.push(...block("Tips", "list", strs(d.tips)));
  return { facts, blocks };
}

function itinerary(d: R): Mapped {
  const facts = [
    labelled("Where", d.destination),
    labelled("Duration", d.duration),
    labelled("Budget", d.budget),
    labelled("Best season", d.bestSeason),
  ].filter(Boolean);
  const blocks: Block[] = [];
  recs(d.days).forEach((day, i) => {
    const n = str(day.day) || String(i + 1);
    const items = recs(day.stops).map((s) => {
      const base = join([str(s.time), str(s.place)]);
      return str(s.note) ? `${base} — ${str(s.note)}` : base;
    });
    blocks.push(
      ...block(
        str(day.title) ? `Day ${n} — ${str(day.title)}` : `Day ${n}`,
        "list",
        items.filter(Boolean),
      ),
    );
  });
  blocks.push(...block("Good to know", "list", strs(d.tips)));
  return { facts, blocks };
}

function place(d: R): Mapped {
  const real = recs(d.venues);
  const venues = real.length ? real : [d]; // legacy single-venue notes keep fields at top level
  const blocks: Block[] = [];
  const theme = str(d.listTheme);
  if (theme && venues.length > 1) blocks.push(...block("About this list", "text", [theme]));
  for (const v of venues) {
    const rating =
      typeof v.rating === "number" && typeof v.user_rating_count === "number"
        ? `${v.rating} (${v.user_rating_count})`
        : str(v.rating);
    const items = [
      join([
        str(v.category) || str(v.cuisine),
        rating,
        str(v.priceForTwo) || str(v.priceRange) || str(v.price_level),
      ]),
      str(v.location) || str(v.formatted_address),
      labelled("Hours", v.timings),
      labelled("Best time", v.bestTime),
      str(v.why),
      labelled("Must try", join(strs(v.mustTry), ", ")),
      labelled("Good for", join(strs(v.goodFor), ", ")),
      ...strs(v.highlights),
      ...strs(v.tips).map((t) => `Tip: ${t}`),
    ].filter(Boolean);
    const links: BlockLink[] = recs(v.action_links ?? v.actions)
      .map((a) => ({ label: str(a.label), url: safeUrl(a.url) }))
      .filter((a) => a.label && a.url);
    if (!links.length && safeUrl(v.website))
      links.push({ label: "Website", url: safeUrl(v.website) });
    const heading = str(v.name) || "Place";
    if (items.length || links.length)
      blocks.push({ heading, kind: "list", items, ...(links.length ? { links } : {}) });
  }
  return { facts: [], blocks };
}

const PROVIDER_TYPE: Record<string, string> = { flatrate: "Stream", rent: "Rent", buy: "Buy" };

function entertainment(d: R): Mapped {
  const blocks: Block[] = [];
  const theme = str(d.listTheme);
  const titles = recs(d.titles).filter((t) => str(t.title));
  if (theme && titles.length > 1) blocks.push(...block("About this list", "text", [theme]));
  for (const t of titles) {
    const kind = t.mediaType === "tv" ? "TV series" : t.mediaType === "movie" ? "Film" : "";
    const byType = new Map<string, string[]>();
    for (const p of recs(t.providers)) {
      if (!str(p.name)) continue;
      const k = PROVIDER_TYPE[str(p.type)] ?? "Stream";
      byType.set(k, [...(byType.get(k) ?? []), str(p.name)]);
    }
    const providers = [...byType].map(([k, names]) => `${k}: ${names.join(", ")}`);
    const items = [
      join([kind, str(t.year), str(t.creator)]),
      join(strs(t.genres), ", "),
      str(t.overview),
      labelled("Why watch", t.why),
      providers.length ? `Where to watch — ${providers.join(" · ")}` : "",
    ].filter(Boolean);
    const b: Block = { heading: str(t.title), kind: "list", items };
    if (str(t.poster_url)) b.image = str(t.poster_url);
    if (providers.length) b.credit = "Streaming data by JustWatch"; // mandatory wherever providers render
    blocks.push(b);
  }
  return { facts: [], blocks };
}

function product(d: R, note: Note): Mapped {
  const rating = str(d.rating);
  const facts = [str(d.brand), str(d.price), rating && `Rated ${rating}`].filter(
    Boolean,
  ) as string[];
  const blocks: Block[] = [];
  blocks.push(...block("Specs", "facts", recs(d.specs).map(line).filter(Boolean)));
  blocks.push(...block("Pros", "list", strs(d.pros)));
  blocks.push(...block("Cons", "list", strs(d.cons)));
  blocks.push(...block("Verdict", "text", [str(d.verdict)].filter(Boolean)));
  const url = safeUrl(d.buyUrl) || safeUrl(note.source_url);
  if (url && blocks.length)
    blocks[0].links = [{ label: `View on ${note.source_domain || "site"}`, url }];
  return { facts, blocks };
}

// Roundup of videos/tools/repos to check out: one card per item, with its link when stated.
function resources(d: R): Mapped {
  const blocks: Block[] = [];
  const ctx = str(d.context);
  if (ctx) blocks.push(...block("Why these", "text", [ctx]));
  for (const it of recs(d.items).filter((i) => str(i.name))) {
    const items = [join([humanize(str(it.kind)), str(it.creator), str(it.cost)]), str(it.what)]
      .filter(Boolean);
    const b: Block = { heading: str(it.name), kind: "list", items };
    if (safeUrl(it.url)) b.links = [{ label: "Open", url: safeUrl(it.url) }];
    blocks.push(b);
  }
  return { facts: [], blocks };
}

const MAPPERS: Record<string, (d: R, n: Note) => Mapped> = {
  recipe,
  workout,
  itinerary,
  place,
  entertainment,
  product,
  resources,
};

// ---- age + platform ---------------------------------------------------------------
function age(note: Note, ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDateShort(note.created_at);
}

const PLATFORMS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  twitter: "X",
  reddit: "Reddit",
};

export function toView(note: Note): NoteView {
  const data: R = isRec(note.data) ? note.data : {};
  const tpl = resolveTemplate(note, data);
  let m: Mapped;
  try {
    const fn = MAPPERS[tpl] as ((d: R, n: Note) => Mapped) | undefined;
    m = fn ? fn(data, note) : generic(data);
    // Typed template found nothing to show (wrong/legacy shape): try the generic reading.
    if (fn && !m.blocks.length) {
      const g = generic(data);
      if (g.blocks.length) m = { ...g, facts: m.facts.length ? m.facts : g.facts };
    }
  } catch {
    try {
      m = generic(data);
    } catch {
      m = { facts: [], blocks: [] };
    }
  }
  const domain = typeof note.source_domain === "string" ? note.source_domain : "";
  const label = domain ? sourceLabel(domain) : "";
  const ms = (() => {
    try {
      return note.created_at?.toMillis?.() ?? note.created_at?.toDate?.().getTime() ?? 0;
    } catch {
      return 0;
    }
  })();
  const ct = typeof note.content_type === "string" ? note.content_type : "";
  const summary = str(note.ai_summary);
  return {
    id: note.id,
    title: str(note.title),
    summary,
    categorySlug: ct,
    category: ct ? noteLabel(ct) : "",
    platform: PLATFORMS[label.toLowerCase()] ?? label,
    creator: m.creator || undefined,
    image: str(note.cover_image_url) || undefined,
    url: str(note.source_url),
    age: age(note, ms),
    duration: m.duration || undefined,
    thin: !!note.is_fallback || data.thin === true,
    facts: m.facts,
    // A block that only repeats the card summary (e.g. generic tldr) adds nothing.
    blocks: m.blocks.filter(
      (b) => !(b.kind === "text" && b.items.length === 1 && b.items[0] === summary),
    ),
    tags: [],
    createdAt: ms,
    note,
  };
}
