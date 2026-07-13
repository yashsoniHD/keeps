import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCapture } from "@/components/CaptureProvider";
import { FOCUS_RING, PRESS } from "@/lib/ui";

// The app's single primary-action FAB: capture a new note. Replaces the old bottom tab bar
// (Home · Collections · + · Ask · Settings) — capture was the only action there that earns a
// persistent control; Ask now rides with search and Settings lives in the feed header.
// Hidden on the chromeless surfaces (sign-in + public viewer), when signed out, and on the
// search screen (that surface's focus belongs to the query, not a floating +).
const HIDDEN_PREFIXES = ["/login", "/share", "/p/", "/search"];

// Ignore scroll jitter below this many px so a stray 1px wobble doesn't toggle the button.
const SCROLL_DELTA = 6;

// Tracks vertical scroll *direction*: the FAB tucks away as the user scrolls up toward the
// top and slides back in as they scroll down into the feed. Starts visible (no scroll yet).
function useScrollDirectionVisible(active: boolean): boolean {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    if (!active) return;
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY.current;
      if (Math.abs(dy) < SCROLL_DELTA) return;
      setVisible(dy > 0); // scrolling down → show; scrolling up → hide
      lastY.current = y;
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

  const hidden = !user || HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  const visible = useScrollDirectionVisible(!hidden);
  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={openCapture}
      aria-label="New note"
      title="New note"
      className={`fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-[transform,opacity] duration-300 ease-out ${PRESS} ${FOCUS_RING} ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-24 opacity-0"
      }`}
    >
      <Plus className="h-6 w-6" aria-hidden />
    </button>
  );
}
