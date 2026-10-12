// Run: cd frontend && node src/keeps/toView.check.ts   (or: npx tsx src/keeps/toView.check.ts)
import assert from "node:assert/strict";
import type { Note } from "../lib/types.ts";
import { degradedState, toView } from "./toView.ts";

const ts = (n: number) =>
  ({ toMillis: () => n, toDate: () => new Date(n) }) as unknown as Note["created_at"];
const mk = (p: Partial<Note>): Note =>
  ({
    id: "n1",
    user_id: "u",
    content_type: "note",
    title: "T",
    ai_summary: "S",
    source_url: "https://x.com/a",
    source_domain: "instagram.com",
    source: "web",
    cover_image_url: null,
    data: {},
    created_at: ts(Date.now() - 3 * 3_600_000),
    updated_at: ts(0),
    ...p,
  }) as Note;

// recipe -> checklist + steps + facts
const r = toView(
  mk({
    content_type: "recipe",
    template: "recipe",
    data: {
      totalTime: "25 minutes",
      servings: "2",
      ingredients: [{ items: ["egg", "salt"] }],
      steps: ["Boil", "Peel"],
      tips: ["Ice bath"],
    },
  }),
);
assert.equal(r.blocks[0].kind, "checklist");
assert.deepEqual(r.blocks[0].items, ["egg", "salt"]);
assert.equal(r.blocks[1].kind, "steps");
assert.ok(r.facts.includes("Serves 2") && r.facts.includes("2 ingredients"));
assert.equal(r.platform, "Instagram");
assert.equal(r.age, "3 hours ago");

// entertainment with providers -> JustWatch credit; without -> none
const e = toView(
  mk({
    content_type: "movies",
    data: {
      titles: [
        {
          title: "Dune",
          year: "2021",
          mediaType: "movie",
          poster_url: "http://p/1.jpg",
          genres: ["Sci-Fi"],
          providers: [{ name: "Netflix", logo_url: null, type: "flatrate" }],
        },
        { title: "Nope" },
      ],
    },
  }),
);
assert.equal(e.blocks[0].credit, "Streaming data by JustWatch");
assert.equal(e.blocks[0].image, "http://p/1.jpg");
assert.equal(e.blocks[1].credit, undefined);

// place with action links
const p = toView(
  mk({
    template: "place",
    data: {
      venues: [
        {
          name: "Cafe",
          category: "Cafe",
          action_links: [{ label: "Directions", url: "http://m", kind: "directions" }],
        },
      ],
    },
  }),
);
assert.equal(p.blocks[0].heading, "Cafe");
assert.deepEqual(p.blocks[0].links, [{ label: "Directions", url: "http://m" }]);

// non-http(s) links from model data are dropped
const pj = toView(
  mk({
    template: "place",
    data: {
      venues: [
        {
          name: "X",
          action_links: [{ label: "Bad", url: "javascript:alert(1)" }],
          website: "javascript:alert(1)",
        },
      ],
    },
  }),
);
assert.ok(!pj.blocks[0]?.links);

// itinerary -> one block per day
const i = toView(
  mk({
    template: "itinerary",
    data: {
      days: [
        { day: 1, title: "Arrive", stops: [{ time: "9am", place: "Fort", note: "go early" }] },
        { day: 2, stops: [] },
      ],
    },
  }),
);
assert.equal(i.blocks[0].heading, "Day 1 — Arrive");
assert.deepEqual(i.blocks[0].items, ["9am · Fort — go early"]);

// generic unknown shape
const g = toView(
  mk({
    content_type: "ai",
    data: {
      key_points: ["a", "b"],
      verdict: "x".repeat(60),
      facts: [{ label: "K", value: "V" }],
      rows: [{ a: 1, b: "two" }],
      thin: true,
    },
  }),
);
assert.equal(g.blocks.find((b) => b.heading === "Key points")?.kind, "list");
assert.equal(g.blocks.find((b) => b.heading === "Verdict")?.kind, "text");
assert.deepEqual(g.blocks.find((b) => b.kind === "facts")?.items, ["K: V"]);
assert.ok(g.thin);

// malformed / legacy: must not throw, whatever the template says
for (const tpl of [
  "recipe",
  "workout",
  "itinerary",
  "place",
  "product",
  "entertainment",
  "summary",
  "resources",
  "",
]) {
  const bad = toView(
    mk({
      template: tpl,
      created_at: undefined as never,
      source_domain: null as never,
      data: {
        ingredients: null,
        steps: 5,
        days: [null, { stops: "x" }],
        venues: [null, 3],
        titles: [null],
        exercises: [{}],
        specs: "x",
        pros: {},
        keyPoints: [null, { a: null }],
        tldr: null,
        items: [null, { name: 3 }, "x"],
      },
    }),
  );
  assert.ok(Array.isArray(bad.blocks) && bad.age === "");
}
assert.doesNotThrow(() => toView(mk({ data: null as never })));
// resources: one card per named item; link only when the URL is safe
const res = toView(
  mk({
    template: "resources",
    data: {
      items: [
        {
          name: "Agent skills",
          kind: "video",
          creator: "Matt Pocock",
          what: "Build skills",
          url: "https://youtu.be/x",
        },
        { name: "Bad link", kind: "tool", what: "y", url: "javascript:alert(1)" },
        { kind: "repo" },
      ],
    },
  }),
);
assert.equal(res.blocks.length, 2);
assert.deepEqual(res.blocks[0].items, ["Video · Matt Pocock", "Build skills"]);
assert.equal(res.blocks[0].links?.[0].url, "https://youtu.be/x");
assert.equal(res.blocks[1].links, undefined);
console.log("toView.check: ok");

// Content-selected documents override both category templates and entertainment metadata.
const doc = toView(
  mk({
    template: "recipe",
    content_type: "recipe",
    data: {
      document: {
        version: 1,
        blocks: [
          { kind: "text", heading: "Why it sticks", items: ["The pan is too cold."] },
          {
            kind: "table",
            heading: "Compare",
            columns: ["Pan", "Cue"],
            rows: [{ cells: ["Hot", "Water dances"] }],
          },
          { kind: "quote", items: ["Heat it first."] },
          { kind: "invalid", items: ["Hidden"] },
        ],
      },
      _evidence: [{ text: "Private extraction detail" }],
      _quality: { review: "passed" },
      titles: [{ title: "Dune", providers: [{ name: "Netflix", type: "flatrate" }] }],
    },
  }),
);
assert.equal(doc.blocks[0].heading, "Why it sticks");
assert.equal(doc.blocks[1].kind, "table");
assert.deepEqual(doc.blocks[1].rows, [["Hot", "Water dances"]]);
assert.equal(doc.blocks[2].kind, "quote");
assert.equal(doc.blocks[3].credit, "Streaming data by JustWatch");
assert.equal(doc.blocks.length, 4);
assert.ok(!JSON.stringify(doc.blocks).includes("Private extraction"));
const malformed = toView(
  mk({
    data: {
      document: { version: 1, blocks: [null, { kind: "table", rows: [null] }] },
      _quality: { review: "failed" },
    },
  }),
);
assert.deepEqual(malformed.blocks, []);

// cover_thumb (data URI stored at ingest) wins over the expiring CDN cover
assert.equal(
  toView(
    mk({
      cover_image_url: "https://cdn/x.jpg",
      cover_thumb: "data:image/jpeg;base64,AA",
    } as Partial<Note>),
  ).image,
  "data:image/jpeg;base64,AA",
);
assert.equal(toView(mk({ cover_image_url: "https://cdn/x.jpg" })).image, "https://cdn/x.jpg");

// degraded reason order + copy
const dr = (p: Partial<Note>) => degradedState(mk(p));
assert.equal(dr({ is_fallback: true, data: { note: "long" } }).reason, "bookmark");
assert.equal(dr({ data: { note: "no thin flag" } }).reason, "none");
assert.deepEqual(dr({ data: { thin: true, note: "Video is 31 m." } }), {
  reason: "too_long",
  label: "Partial",
  banner: "Video is 31 m.",
  canRegenerate: false,
});
assert.equal(dr({ acquisition: "reel_video_thin" }).label, "Caption only");
assert.equal(dr({ acquisition: "social_og" }).reason, "caption");
assert.equal(dr({ acquisition: "youtube_fallback" }).banner, "");
assert.equal(dr({ acquisition: "youtube_fallback" }).canRegenerate, false);
assert.equal(dr({ data: { _quality: { composition: "fallback" } } }).label, "");
assert.equal(dr({ data: { _quality: { composition: "fallback" } } }).banner, "Saved unformatted.");
assert.equal(dr({}).reason, "none");
assert.equal(toView(mk({ is_fallback: true })).degradedLabel, "Bookmark");

// YouTube document blocks get a timestamp link to the earliest cited moment
const yt = toView(
  mk({
    source_domain: "youtube.com",
    source_url: "https://www.youtube.com/watch?v=abc",
    data: {
      document: {
        version: 1,
        blocks: [
          { kind: "list", heading: "A", items: ["x"], evidence_ids: ["e2", "e1"] },
          { kind: "list", heading: "B", items: ["y"], evidence_ids: ["e3"] },
        ],
      },
      _evidence: [
        { id: "e1", timestamp: "03:12" },
        { id: "e2", timestamp: "1:02:03" },
        { id: "e3", timestamp: "around the end" },
      ],
    },
  }),
);
assert.deepEqual(yt.blocks[0].links?.[0], {
  label: "▶ 03:12",
  url: "https://www.youtube.com/watch?v=abc&t=192s",
});
assert.equal(yt.blocks[1].links?.length ?? 0, 0);
const ig = toView(
  mk({
    data: {
      document: { version: 1, blocks: [{ kind: "list", items: ["x"], evidence_ids: ["e1"] }] },
      _evidence: [{ id: "e1", timestamp: "00:05" }],
    },
  }),
);
assert.equal(ig.blocks[0].links?.length ?? 0, 0);
const ytFrag = toView(
  mk({
    source_domain: "youtu.be",
    source_url: "https://youtu.be/abc#frag",
    data: {
      document: {
        version: 1,
        blocks: [
          { kind: "list", items: ["x"], evidence_ids: ["e1"] },
          { kind: "list", items: ["y"], evidence_ids: ["e2"] },
        ],
      },
      _evidence: [
        { id: "e1", timestamp: "00:05" },
        { id: "e2", timestamp: "75:00" },
      ],
    },
  }),
);
assert.equal(ytFrag.blocks[0].links?.[0].url, "https://youtu.be/abc?t=5s");
assert.equal(ytFrag.blocks[1].links?.length ?? 0, 0);
// data.note without thin stays in the body; with thin it is the banner only
const shown = (d: Record<string, unknown>) => {
  const v = toView(mk({ data: d }));
  return JSON.stringify([v.facts, v.blocks]).includes("Heads up");
};
assert.ok(shown({ note: "Heads up" }));
assert.ok(!shown({ thin: true, note: "Heads up", body: "x".repeat(50) }));
const docNote = (thin: boolean) =>
  shown({
    thin,
    note: "Heads up",
    document: { version: 1, blocks: [{ kind: "text", items: ["a"] }] },
  });
assert.ok(docNote(false) && !docNote(true));
console.log("toView.check: degraded/timestamps ok");
