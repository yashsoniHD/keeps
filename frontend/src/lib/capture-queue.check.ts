// Run: cd frontend && node src/lib/capture-queue.check.ts
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: object }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const { enqueueCapture, loadQueue, replayWith, isQueueable } =
  await import("./capture-queue-core.ts");

// (a) a queue written for A is invisible to B
enqueueCapture("A", "https://a.com/1");
enqueueCapture("A", "https://a.com/2");
enqueueCapture("A", "https://a.com/3");
assert.equal(loadQueue("A").length, 3);
assert.deepEqual(loadQueue("B"), []);

// (b) replay for A stops when isCurrent() flips false mid-run
let current = true;
const seen: string[] = [];
const left = await replayWith(
  "A",
  () => current,
  async (url) => {
    seen.push(url);
    current = false; // user switched during the first ingest
  },
  () => false,
);
assert.deepEqual(seen, ["https://a.com/1"]);
assert.deepEqual(
  left.map((q) => q.url),
  ["https://a.com/2", "https://a.com/3"],
);
assert.equal(loadQueue("A").length, 2);
assert.deepEqual(loadQueue("B"), []);

// (c) error classes: 429 / 5xx / network / Firebase lie-fi queue; other 4xx do not
const err = (status: number) => Object.assign(new Error("x"), { status });
assert.ok(isQueueable(err(429)) && isQueueable(err(503)) && isQueueable(new TypeError("fetch")));
assert.ok(isQueueable({ code: "auth/network-request-failed" }));
assert.ok(!isQueueable(err(400)) && !isQueueable(err(404)));

// (d) a 429 mid-replay stops and keeps the rest; a 400 drops the entry and names the host
enqueueCapture("C", "https://www.ok.com/1");
enqueueCapture("C", "https://rate.com/2");
enqueueCapture("C", "https://after.com/3");
const rest = await replayWith(
  "C",
  () => true,
  async (url) => {
    if (url.includes("rate")) throw err(429);
  },
  isQueueable,
);
assert.deepEqual(
  rest.map((q) => q.url),
  ["https://rate.com/2", "https://after.com/3"],
);
enqueueCapture("D", "https://www.bad.com/x");
const rejected: string[] = [];
await replayWith(
  "D",
  () => true,
  async () => {
    throw err(400);
  },
  isQueueable,
  (_u, m) => rejected.push(m),
);
assert.equal(loadQueue("D").length, 0);
assert.ok(rejected[0].includes("bad.com"));
console.log("capture-queue.check: ok");
