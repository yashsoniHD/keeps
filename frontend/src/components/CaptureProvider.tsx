import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AlertCircle, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ingest, ingestText } from "@/lib/api";
import { AddNoteSheet } from "@/components/AddNoteSheet";

// App-wide capture, lifted above the router <Outlet /> so the bottom-nav's + button can open
// the same New-note sheet from ANY route (note detail, search…), not just the
// feed. The feed keeps its own in-feed FAB + handlers untouched (optimistic cards live there);
// this provider is the off-feed path. On submit it fires the same ingest helpers the feed uses,
// then lands the user on the feed so the processing card is visible.
type CaptureCtx = { openCapture: () => void };
const CaptureContext = createContext<CaptureCtx>({ openCapture: () => {} });

// eslint-disable-next-line react-refresh/only-export-components
export const useCapture = () => useContext(CaptureContext);

export function CaptureProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [showAdd, setShowAdd] = useState(false);
  const [pendingUrl, setPendingUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const openCapture = useCallback(() => {
    setError(null);
    setPendingUrl("");
    setShowAdd(true);
  }, []);

  // Land on the feed after firing an off-feed capture so the processing card is seen.
  const goToFeed = () => {
    if (pathname !== "/") navigate({ to: "/" });
  };

  const onSubmitUrl = (raw: string) => {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setShowAdd(false);
    setError(null);
    ingest(url)
      .then((r) => {
        if (r.status === "completed" && r.note_id)
          navigate({ to: "/notes/$noteId", params: { noteId: r.note_id } }); // already saved
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't start the capture."));
    goToFeed();
  };
  const onSubmitText = async (text: string, title?: string, processAI = true) => {
    setShowAdd(false);
    setError(null);
    try {
      await ingestText(text, title, processAI);
      goToFeed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the note.");
    }
  };

  return (
    <CaptureContext.Provider value={{ openCapture }}>
      {children}

      {error && user && (
        <div className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-md items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive shadow-lg">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {showAdd && (
        <AddNoteSheet
          url={pendingUrl}
          setUrl={setPendingUrl}
          onCancel={() => setShowAdd(false)}
          onSubmit={onSubmitUrl}
          onSubmitText={onSubmitText}
        />
      )}
    </CaptureContext.Provider>
  );
}
