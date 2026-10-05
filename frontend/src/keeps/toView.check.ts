// Run: cd frontend && node src/keeps/toView.check.ts   (or: npx tsx src/keeps/toView.check.ts)
import assert from "node:assert/strict";
import type { Note } from "../lib/types.ts";
import { toView } from "./toView.ts";

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
      },
    }),
  );
  assert.ok(Array.isArray(bad.blocks) && bad.age === "");
}
assert.doesNotThrow(() => toView(mk({ data: null as never })));
console.log("toView.check: ok");
