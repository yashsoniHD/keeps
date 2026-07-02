import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { House, Plus, RefreshCw, Search, Settings, Sparkle, type LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { ingestMedia, ingestText, ingestVoice } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";
import { AddNoteSheet } from "@/components/AddNoteSheet";
import { CaptureModal } from "@/components/CaptureModal";

// How far (px, after resistance) the user must pull before release triggers a reload.
const THRESHOLD = 70;

// Routes with no app chrome (bottom nav / capture): signed-out + public viewer surfaces.
const CHROMELESS_PREFIXES = ["/login", "/share", "/p/"];

// --- Capture: owned by the shell, opened from anywhere -------------------------------------
// The capture flow (paste a link / write / upload / record) lives in the shell so every screen —
// and the bottom nav's + — can trigger it through one context, instead of each screen re-wiring it.
type CaptureCtx = { openCapture: (url?: string) => void };
const CaptureContext = createContext<CaptureCtx>({ openCapture: () => {} });
export const useCapture = () => useContext(CaptureContext);

// Custom pull-to-refresh for touch devices: the installed PWA has no browser chrome —
// no reload button, and iOS standalone mode has no native pull-to-refresh either. A
// full reload is the point (it revalidates index.html, picking up new deploys), not
// just a data refetch — the Firestore feed is already live via onSnapshot.
// Touches starting inside [data-no-refresh] elements (e.g. the add-link sheet) are
// ignored so a drag inside an overlay can't reload the app and eat typed input.
function usePullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const active = useRef(false);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!("ontouchstart" in window)) return;

    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0) return;
      if ((e.target as Element | null)?.closest?.("[data-no-refresh]")) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (window.scrollY > 0 || dy <= 0) {
        set(0);
        return;
      }
      set(Math.min(dy * 0.4, 100)); // resistance: 40% of finger travel, capped
    };
    const onEnd = () => {
      if (!active.current) return;
      active.current = false;
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        window.location.reload();
      } else {
        set(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return { pull, refreshing };
}

// One bottom-nav destination. The center Capture (+) is styled as the brand action.
function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  to,
  primary,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
  to?: string;
  primary?: boolean;
}) {
  const inner = primary ? (
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg shadow-brand/30 transition-transform active:scale-90 motion-reduce:active:scale-100">
      <Icon className="h-6 w-6" />
    </span>
  ) : (
    <span className="flex flex-col items-center gap-0.5">
      <Icon className={`h-6 w-6 ${active ? "text-brand" : "text-ink-soft"}`} strokeWidth={active ? 2.4 : 2} />
      <span className={`text-[10px] font-medium ${active ? "text-brand" : "text-ink-soft"}`}>{label}</span>
    </span>
  );

  const cls = `flex flex-1 items-center justify-center py-2 ${FOCUS_RING} rounded-2xl`;
  if (to) {
    return (
      <Link to={to} aria-label={label} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cls}>
      {inner}
    </button>
  );
}

// Mobile bottom tab bar — the app's primary navigation. Home · Search · Capture(+) · Clip AI · You.
// Hidden on desktop (md+), where the per-screen headers carry navigation.
function BottomNav({ onCapture }: { onCapture: () => void }) {
  const { toggleChat, isOpen } = useAsk();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Primary"
      data-no-refresh
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-lg items-center px-2">
        <NavItem icon={House} label="Home" to="/" active={pathname === "/"} />
        <NavItem icon={Search} label="Search" to="/search" active={pathname.startsWith("/search")} />
        <NavItem icon={Plus} label="Save" onClick={onCapture} primary />
        <NavItem icon={Sparkle} label="Clip AI" onClick={toggleChat} active={isOpen} />
        <NavItem
          icon={Settings}
          label="You"
          to="/settings"
          active={pathname.startsWith("/settings")}
        />
      </div>
    </nav>
  );
}

// The app frame: pull-to-refresh, the mobile bottom nav, and the shell-owned capture flow.
// Navigation on desktop still lives in each screen's header (unified in later passes); the
// bottom nav is mobile-only, so the two never collide.
export function AppShell({ children }: { children: ReactNode }) {
  const { pull, refreshing } = usePullToRefresh();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visible = pull > 0 || refreshing;

  // Shell-owned capture state.
  const [showAdd, setShowAdd] = useState(false);
  const [pendingUrl, setPendingUrl] = useState("");
  const [capturingUrl, setCapturingUrl] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const chromeless = !user || CHROMELESS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));

  const openCapture = (url?: string) => {
    setIngestError(null);
    setPendingUrl(url ?? "");
    setShowAdd(true);
  };
  const onSubmitUrl = (raw: string) => {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setShowAdd(false);
    setIngestError(null);
    setCapturingUrl(url); // CaptureModal ingests + routes to wherever it lands (note or tool)
  };
  const onSubmitText = async (text: string, title?: string, processAI = true) => {
    setShowAdd(false);
    try {
      await ingestText(text, title, processAI);
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : "Couldn't save the note.");
    }
  };
  const onUploadFile = async (file: File, kind: "image" | "pdf" | "video" | "voice") => {
    await ingestMedia(file, kind, file.name);
    setShowAdd(false);
  };
  const onUploadVoice = async (blob: Blob) => {
    await ingestVoice(blob);
    setShowAdd(false);
  };

  return (
    <CaptureContext.Provider value={{ openCapture }}>
      <div className={`min-h-screen bg-background ${chromeless ? "" : "pb-20 md:pb-0"}`}>
        {visible && (
          <div
            className="pointer-events-none fixed left-1/2 top-0 z-50"
            style={{
              transform: `translate(-50%, ${(refreshing ? 80 : Math.min(pull, 80)) - 44}px)`,
              opacity: refreshing ? 1 : Math.min(pull / THRESHOLD, 1),
            }}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-md">
              <RefreshCw
                className={`h-4 w-4 ${pull >= THRESHOLD || refreshing ? "text-brand" : "text-ink-soft"} ${refreshing ? "animate-spin" : ""}`}
                style={refreshing ? undefined : { transform: `rotate(${pull * 2.5}deg)` }}
              />
            </span>
          </div>
        )}

        {ingestError && !chromeless && (
          <div className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive shadow-lg">
            <span className="flex-1">{ingestError}</span>
            <button type="button" onClick={() => setIngestError(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {children}

        {!chromeless && <BottomNav onCapture={() => openCapture()} />}
      </div>

      {showAdd && (
        <AddNoteSheet
          url={pendingUrl}
          setUrl={setPendingUrl}
          onCancel={() => setShowAdd(false)}
          onSubmit={onSubmitUrl}
          onSubmitText={onSubmitText}
          onUploadFile={onUploadFile}
          onUploadVoice={onUploadVoice}
        />
      )}
      {capturingUrl && <CaptureModal url={capturingUrl} onClose={() => setCapturingUrl(null)} />}
    </CaptureContext.Provider>
  );
}
