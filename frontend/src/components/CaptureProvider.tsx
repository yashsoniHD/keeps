import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/contexts/auth-context";
import { ingest } from "@/lib/api";
import { analytics } from "@/lib/analytics";
import {
  enqueueCapture,
  isQueueableError,
  loadQueue,
  replayQueue,
  type QueuedCapture,
} from "@/lib/capture-queue";
import { CaptureSheet, SavedSheet } from "@/keeps/CaptureSheet";
import { Toast } from "@/keeps/ui";

// App-wide capture, lifted above the router <Outlet /> so the "+" can open the same sheet from
// ANY route. This is the ONE place that owns ingest, the optimistic placeholders, the offline
// queue (replayed on sign-in and when the connection returns), the duplicate notice and the
// `keeps.pendingCapture` replay. The library reads the lists via useCapture() to render rows.
export interface Optimistic {
  id: string;
  url: string;
}
interface CaptureCtx {
  openCapture: () => void;
  /** Start a capture for a URL (adds scheme if missing). Used by sample / retry / sheet. */
  capture: (raw: string) => Promise<void>;
  /** In-flight local placeholders (not yet visible as a server job/note). */
  optimistic: Optimistic[];
  /** Offline-held captures waiting for the connection. */
  queued: QueuedCapture[];
  /** Drop placeholders whose URL the server now knows about (a job or note exists). */
  settle: (knownUrls: Set<string>) => void;
  /** Re-read the offline queue from storage and replay it (call after enqueueing elsewhere). */
  refreshQueue: () => void;
}
const CaptureContext = createContext<CaptureCtx>({
  openCapture: () => {},
  capture: async () => {},
  optimistic: [],
  queued: [],
  settle: () => {},
  refreshQueue: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export const useCapture = () => useContext(CaptureContext);

export function CaptureProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [showAdd, setShowAdd] = useState(false);
  const [optimistic, setOptimistic] = useState<Optimistic[]>([]);
  const [queued, setQueued] = useState<QueuedCapture[]>(() => (user ? loadQueue(user.uid) : []));
  const [dupNoteId, setDupNoteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const seq = useRef(0);
  const uidRef = useRef(user?.uid ?? null);
  uidRef.current = user?.uid ?? null;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const openCapture = useCallback(() => setShowAdd(true), []);

  // Toasts auto-dismiss (Toast leaves the timer to the owner).
  useEffect(() => {
    if (!toast || toast.error) return; // errors persist until dismissed
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Fire-and-forget capture: the job doc (and thus the processing row) appears within a few
  // hundred ms; the local placeholder covers that gap so feedback is instant.
  const capture = useCallback(
    async (raw: string) => {
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      setShowAdd(false);
      setToast(null);
      setDupNoteId(null);
      const tempId = `opt-${url}-${seq.current++}`;
      setOptimistic((prev) => [{ id: tempId, url }, ...prev]);
      // Safety net: drop the placeholder if the listener never replaces it (e.g. the backend
      // rewrote the URL so it can't be matched). Longer than any real job.
      setTimeout(() => setOptimistic((prev) => prev.filter((o) => o.id !== tempId)), 120_000);
      // Land on the library so the processing row is seen.
      if (pathRef.current !== "/") navigate({ to: "/" });
      try {
        const r = await ingest(url);
        if (r.status === "completed") {
          // Exact duplicate: no job will appear, so drop the placeholder and point at the note.
          setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
          if (r.note_id) setDupNoteId(r.note_id);
          return;
        }
        analytics.firstCapture(); // funnel: first successful capture (once per browser)
        analytics.noteSaved();
        setToast({ message: "Link saved. Building your note…" });
      } catch (e) {
        setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
        if (isQueueableError(e)) {
          // Offline / server down: hold the URL locally and show a "waiting" row — the capture
          // is parked, not lost. Replayed by the effect below.
          if (user) setQueued(enqueueCapture(user.uid, url));
        } else {
          setToast({
            message:
              e instanceof Error ? e.message : "Couldn't start the capture. Please try again.",
            error: true,
          });
        }
      }
    },
    [navigate, user],
  );

  const settle = useCallback((known: Set<string>) => {
    setOptimistic((prev) => {
      const next = prev.filter((o) => !known.has(o.url));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  // Offline-queued captures replay on sign-in, whenever the connection returns, and on demand
  // (refreshQueue). Server-rejected entries (4xx) are dropped with their error surfaced; network
  // failures keep the rest of the queue intact. One replay at a time so a URL isn't ingested twice.
  const replaying = useRef(false);
  const refreshQueue = useCallback(() => {
    if (!user) {
      setQueued([]);
      return;
    }
    const uid = user.uid;
    const q = loadQueue(uid);
    setQueued(q);
    if (replaying.current || q.length === 0) return;
    replaying.current = true;
    replayQueue(
      uid,
      () => uidRef.current === uid,
      (_url, message) => setToast({ message, error: true }),
    )
      .then((rest) => {
        if (uidRef.current === uid) setQueued(rest);
      })
      .finally(() => {
        replaying.current = false;
      });
  }, [user]);
  useEffect(() => {
    refreshQueue(); // also clears `queued` on sign-out
    if (!user) return;
    window.addEventListener("online", refreshQueue);
    return () => window.removeEventListener("online", refreshQueue);
  }, [user, refreshQueue]);

  // A URL pasted on the landing page before sign-in is parked in localStorage and captured
  // here once the user is authed, so "Try it free" lands a real first note.
  const pendingHandled = useRef(false);
  useEffect(() => {
    if (!user || pendingHandled.current) return;
    let pending: string | null = null;
    try {
      pending = localStorage.getItem("keeps.pendingCapture");
      if (pending) localStorage.removeItem("keeps.pendingCapture");
    } catch {
      /* private mode / storage disabled — nothing to replay */
    }
    if (!pending) return;
    pendingHandled.current = true;
    capture(pending);
  }, [user, capture]);

  const value = useMemo(
    () => ({ openCapture, capture, optimistic, queued, settle, refreshQueue }),
    [openCapture, capture, optimistic, queued, settle, refreshQueue],
  );

  return (
    <CaptureContext.Provider value={value}>
      {children}
      {user && showAdd && <CaptureSheet onSubmit={capture} onClose={() => setShowAdd(false)} />}
      {user && dupNoteId && (
        <SavedSheet
          noteId={dupNoteId}
          onClose={() => setDupNoteId(null)}
          onView={() => {
            const noteId = dupNoteId;
            setDupNoteId(null);
            navigate({ to: "/notes/$noteId", params: { noteId } });
          }}
        />
      )}
      {user && toast && (
        <Toast
          message={toast.message}
          icon={toast.error ? "HelpCircle" : "CheckCircle2"}
          error={toast.error}
          onDismiss={() => setToast(null)}
        />
      )}
    </CaptureContext.Provider>
  );
}
