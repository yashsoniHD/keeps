import { ApiError, ingest } from "@/lib/api";
import { replayWith, type QueuedCapture } from "./capture-queue-core.ts";

// localStorage-backed capture queue: a pasted/shared URL that can't reach the backend
// (offline, fetch failure, 5xx) is held here and replayed when the connection returns.
// The capture is never silently dropped. Queues are per Firebase UID (see capture-queue-core.ts).
export {
  loadQueue,
  enqueueCapture,
  dequeueCapture,
  type QueuedCapture,
} from "./capture-queue-core.ts";

// Queue only what a later retry can fix: network failures (fetch rejects with
// TypeError), explicit offline, and 5xx. A 4xx (rate cap, invalid URL) would fail
// identically on every replay — surface it instead.
export function isQueueableError(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return e instanceof TypeError;
}

export function replayQueue(
  uid: string,
  isCurrent: () => boolean,
  onRejected?: (url: string, message: string) => void,
): Promise<QueuedCapture[]> {
  return replayWith(uid, isCurrent, ingest, isQueueableError, onRejected);
}
