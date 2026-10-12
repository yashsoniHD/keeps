import { ingest } from "@/lib/api";
import { isQueueable, replayWith, type QueuedCapture } from "./capture-queue-core.ts";

// localStorage-backed capture queue: a pasted/shared URL that can't reach the backend
// (offline, fetch failure, 5xx) is held here and replayed when the connection returns.
// The capture is never silently dropped. Queues are per Firebase UID (see capture-queue-core.ts).
export {
  loadQueue,
  enqueueCapture,
  dequeueCapture,
  type QueuedCapture,
} from "./capture-queue-core.ts";

// What a later retry can fix (network, offline, 5xx, 429): see capture-queue-core.ts.
export const isQueueableError = isQueueable;

export function replayQueue(
  uid: string,
  isCurrent: () => boolean,
  onRejected?: (url: string, message: string) => void,
): Promise<QueuedCapture[]> {
  return replayWith(uid, isCurrent, ingest, isQueueableError, onRejected);
}
