import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

// How far (px, after resistance) the user must pull before release triggers a reload.
const THRESHOLD = 70;

// Input modes a capture composer can open in (focused link field, text, file picker, voice
// recorder). Defined here as the shared type AddNoteSheet consumes; the live capture flow that
// uses it lives in CaptureProvider (driven by the bottom-nav + button), not this shell.
export type CaptureMode = "link" | "text" | "file" | "voice";

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

// The app frame: shell layout + pull-to-refresh. Primary navigation lives in the global bottom
// tab bar (components/BottomNav.tsx: Home · Collections · + · Ask · Search); the app-wide capture
// flow lives in CaptureProvider (__root.tsx), which the bottom bar's + button drives.
export function AppShell({ children }: { children: ReactNode }) {
  const { pull, refreshing } = usePullToRefresh();
  const visible = pull > 0 || refreshing;

  return (
    <div className="min-h-screen bg-background">
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
              className={`h-4 w-4 ${pull >= THRESHOLD || refreshing ? "text-ink" : "text-ink-soft"} ${refreshing ? "animate-spin" : ""}`}
              style={refreshing ? undefined : { transform: `rotate(${pull * 2.5}deg)` }}
            />
          </span>
        </div>
      )}

      {children}
    </div>
  );
}
