import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCapture } from "@/components/CaptureProvider";
import { FOCUS_RING, PRESS } from "@/lib/ui";

// The app's single primary-action FAB: capture a new note. Settings lives in the feed header.
// Home-only: every other surface (note detail, settings, search) is a focused context where a
// floating + is noise.

// Only react once a scroll gesture accumulates past this many px, so momentum wobble and
// sub-pixel jitter don't flip the button back and forth mid-scroll.
const SCROLL_DELTA = 12;
// Near the top there's nothing to read past, so the FAB always shows there (its resting state).
const TOP_ZONE = 80;

// Tracks vertical scroll *direction*: the FAB tucks away as the user scrolls down into the
// feed (reading) and slides back in as they scroll up. Always visible near the top. Direction
// is measured against the last point where it flipped, not the last scroll event, so a long
// steady drag doesn't keep re-triggering on every pixel. Starts visible.
function useScrollDirectionVisible(active: boolean): boolean {
  const [visible, setVisible] = useState(true);
  const anchorY = useRef(0);
  const visRef = useRef(true);

  useEffect(() => {
    if (!active) return;
    anchorY.current = window.scrollY;
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      if (y < TOP_ZONE) {
        anchorY.current = y;
        if (!visRef.current) {
          visRef.current = true;
          setVisible(true);
        }
        return;
      }
      const dy = y - anchorY.current;
      if (Math.abs(dy) < SCROLL_DELTA) return;
      const next = dy < 0; // scrolling up → show; scrolling down → hide
      anchorY.current = y;
      if (next !== visRef.current) {
        visRef.current = next;
        setVisible(next);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [active]);

  return visible;
}

export function CaptureFab() {
  const { user } = useAuth();
  const { openCapture } = useCapture();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const hidden = !user || pathname !== "/";
  const visible = useScrollDirectionVisible(!hidden);
  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={openCapture}
      aria-label="New note"
      title="New note"
      className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${PRESS} ${FOCUS_RING} ${
        visible
          ? "translate-y-0 scale-100 opacity-100"
          : "pointer-events-none translate-y-20 scale-75 opacity-0"
      }`}
    >
      <Plus className="h-6 w-6" aria-hidden />
    </button>
  );
}
