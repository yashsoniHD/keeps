// Storage + ownership logic for the offline capture queue. No app imports so it runs in plain
// node (see capture-queue.check.ts). The queue is keyed by Firebase UID so one account's
// offline captures are never replayed into another account.
// The legacy ownerless `keeps.captureQueue` key is deliberately left unread: its entries can't be attributed.

export interface QueuedCapture {
  url: string;
  ts: number;
}

const key = (uid: string) => `keeps.captureQueue.${uid}`;
const MAX_ENTRIES = 50;

export function loadQueue(uid: string): QueuedCapture[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(uid)) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is QueuedCapture => typeof q?.url === "string" && typeof q?.ts === "number",
    );
  } catch {
    return [];
  }
}

function save(uid: string, queue: QueuedCapture[]) {
  try {
    localStorage.setItem(key(uid), JSON.stringify(queue.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full/blocked — the in-memory copy still drives this session */
  }
}

export function enqueueCapture(uid: string, url: string): QueuedCapture[] {
  const queue = loadQueue(uid).filter((q) => q.url !== url); // dedupe by URL
  queue.push({ url, ts: Date.now() });
  const capped = queue.slice(-MAX_ENTRIES);
  save(uid, capped);
  return capped;
}

export function dequeueCapture(uid: string, url: string): QueuedCapture[] {
  const queue = loadQueue(uid).filter((q) => q.url !== url);
  save(uid, queue);
  return queue;
}

// Replays the queue in order. Stops at the first still-unreachable entry (the rest
// would fail the same way) or as soon as `isCurrent()` is false (the signed-in user
// changed); drops entries the server permanently rejects so they don't wedge the queue,
// reporting them via onRejected.
export async function replayWith(
  uid: string,
  isCurrent: () => boolean,
  ingestFn: (url: string) => Promise<unknown>,
  isQueueable: (e: unknown) => boolean,
  onRejected?: (url: string, message: string) => void,
): Promise<QueuedCapture[]> {
  let queue = loadQueue(uid);
  for (const item of [...queue]) {
    if (!isCurrent()) break;
    try {
      await ingestFn(item.url);
      queue = dequeueCapture(uid, item.url);
    } catch (e) {
      if (isQueueable(e)) break;
      queue = dequeueCapture(uid, item.url);
      if (isCurrent())
        onRejected?.(item.url, e instanceof Error ? e.message : "Couldn't save this link.");
    }
  }
  return queue;
}
