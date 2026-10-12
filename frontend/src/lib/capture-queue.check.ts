// Run: cd frontend && node src/lib/capture-queue.check.ts
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: object }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const { enqueueCapture, loadQueue, replayWith } = await import("./capture-queue-core.ts");

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
console.log("capture-queue.check: ok");
