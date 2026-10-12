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
import { ApiError, ingest } from "@/lib/api";
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
  /** The server job this placeholder stands for, once ingest returned it. */
  jobId?: string;
}
interface CaptureCtx {
  openCapture: () => void;
  /** Start a capture for a URL (adds scheme if missing). Used by sample / retry / sheet. */
  capture: (raw: string) => Promise<void>;
  /** In-flight local placeholders (not yet visible as a server job/note). */
  optimistic: Optimistic[];
  /** Offline-held captures waiting for the connection. */
  queued: QueuedCapture[];
  /** Drop placeholders whose URL or job id the server now shows (a visible job or note). */
  settle: (known: Set<string>) => void;
  /** Re-read the offline queue from storage and replay it (call after enqueueing elsewhere). */
  refreshQueue: () => void;
  /** App-wide toast (survives the caller unmounting, e.g. a sheet closing after delete). */
  notify: (message: string, error?: boolean) => void;
}
const CaptureContext = createContext<CaptureCtx>({
  openCapture: () => {},
  capture: async () => {},
  optimistic: [],
  queued: [],
  settle: () => {},
  refreshQueue: () => {},
  notify: () => {},
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
        if (r.status === "completed" || r.status === "failed") {
          // Exact duplicate: no job will appear, so drop the placeholder and point at the note.
          // Failed (dispatch failed): the failed job card replaces the placeholder.
          setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
          if (r.status === "failed")
            setToast({ message: "Couldn't start building this note. Tap Retry.", error: true });
          else if (r.note_id) setDupNoteId(r.note_id);
          return;
        }
        // Match the placeholder on the job id (the job stores the canonical URL, not the raw one).
        if (r.job_id)
          setOptimistic((prev) =>
            prev.map((o) => (o.id === tempId ? { ...o, jobId: r.job_id } : o)),
          );
        analytics.firstCapture(); // funnel: first successful capture (once per browser)
        analytics.noteSaved();
        setToast({
          message:
            r.status === "deferred"
              ? "Saved. Queued, it'll be ready soon."
              : "Link saved. Building your note…",
        });
      } catch (e) {
        setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
        if (isQueueableError(e)) {
          // Offline / server down / rate-limited: hold the URL locally and show a "waiting" row —
          // the capture is parked, not lost. Replayed by the effects below.
          if (user) setQueued(enqueueCapture(user.uid, url));
          if (e instanceof ApiError && e.status === 429)
            setToast({ message: `${e.message} Keeps will retry this link.`, error: true });
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
      const next = prev.filter((o) => !known.has(o.url) && !(o.jobId && known.has(o.jobId)));
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
    // iOS fires `online` unreliably; returning to the app is the other natural retry point.
    const onVisible = () => document.visibilityState === "visible" && refreshQueue();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", refreshQueue);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, refreshQueue]);
  // A 5xx/429 while online fires no `online` event: one backoff timer while anything is queued.
  useEffect(() => {
    if (!queued.length) return;
    const t = setTimeout(refreshQueue, 30_000);
    return () => clearTimeout(t);
  }, [queued, refreshQueue]);

  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);

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
    () => ({ openCapture, capture, optimistic, queued, settle, refreshQueue, notify }),
    [openCapture, capture, optimistic, queued, settle, refreshQueue, notify],
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
