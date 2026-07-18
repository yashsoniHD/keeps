import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { createMMKV } from "react-native-mmkv";
import { ApiError, ingest } from "./api";

// MMKV-backed capture queue: a pasted/shared URL that can't reach the backend (offline, fetch
// failure, 5xx) is held here and replayed when the connection returns. The capture is never
// silently dropped.
//
// Port note: web persisted to localStorage; here we use a dedicated MMKV instance. The web app
// drove replay from `window` "online" events — RN has no such event, so `startCaptureReplay()`
// below wires the same behaviour to NetInfo's connectivity transitions.

const storage = createMMKV({ id: "clipnote-queue" });

export interface QueuedCapture {
  url: string;
  ts: number;
}

const KEY = "clipnote.captureQueue";
const MAX_ENTRIES = 50;

export function loadQueue(): QueuedCapture[] {
  try {
    const parsed = JSON.parse(storage.getString(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q): q is QueuedCapture => typeof q?.url === "string" && typeof q?.ts === "number",
    );
  } catch {
    return [];
  }
}

function save(queue: QueuedCapture[]) {
  try {
    storage.set(KEY, JSON.stringify(queue.slice(-MAX_ENTRIES)));
  } catch {
    /* storage full/blocked — the in-memory copy still drives this session */
  }
}

export function enqueueCapture(url: string): QueuedCapture[] {
  const queue = loadQueue().filter((q) => q.url !== url); // dedupe by URL
  queue.push({ url, ts: Date.now() });
  const capped = queue.slice(-MAX_ENTRIES);
  save(capped);
  return capped;
}

export function dequeueCapture(url: string): QueuedCapture[] {
  const queue = loadQueue().filter((q) => q.url !== url);
  save(queue);
  return queue;
}

// Queue only what a later retry can fix: network failures (fetch rejects with TypeError) and
// 5xx. A 4xx (rate cap, invalid URL) would fail identically on every replay — surface it instead.
// (Web also checked navigator.onLine here; RN has no synchronous online flag, and an offline
// fetch already rejects with TypeError, so that branch is dropped without changing behaviour.)
export function isQueueableError(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500;
  return e instanceof TypeError;
}

// Replays the queue in order. Stops at the first still-unreachable entry (the rest would fail
// the same way); drops entries the server permanently rejects so they don't wedge the queue,
// reporting them via onRejected.
export async function replayQueue(
  onRejected?: (url: string, message: string) => void,
): Promise<QueuedCapture[]> {
  let queue = loadQueue();
  for (const item of [...queue]) {
    try {
      await ingest(item.url);
      queue = dequeueCapture(item.url);
    } catch (e) {
      if (isQueueableError(e)) break;
      queue = dequeueCapture(item.url);
      onRejected?.(item.url, e instanceof Error ? e.message : "Couldn't save this link.");
    }
  }
  return queue;
}

// RN replacement for the web `window` "online" listener: replay the queue whenever connectivity
// transitions from offline → online. Returns the NetInfo unsubscribe fn.
export function startCaptureReplay(
  onRejected?: (url: string, message: string) => void,
): () => void {
  let wasConnected: boolean | null = null;
  return NetInfo.addEventListener((state: NetInfoState) => {
    const connected = state.isConnected;
    // Only fire on a false → true edge, not on every state emission.
    if (connected && wasConnected === false && loadQueue().length > 0) {
      void replayQueue(onRejected);
    }
    wasConnected = connected;
  });
}
