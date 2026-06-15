import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { WandSparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { AskChat } from "./AskChat";

// Routes where the Ask-AI FAB has no place: signed-out / public viewer surfaces.
const HIDDEN_PREFIXES = ["/login", "/share", "/p/"];

// Past this much downward drag, releasing dismisses the mobile sheet (otherwise it snaps back).
const DISMISS_THRESHOLD = 110;

// Global Ask-AI launcher (FAB) + chat overlay. Mounted once in __root.tsx (inside the provider
// tree) so it persists across navigation. Two presentations:
//   • Desktop (sm+): a full-height right rail.
//   • Mobile: a full-screen sheet you can flick down to dismiss (Notion-AI style).
// The FAB is the launcher; while open it's hidden (the sheet/rail covers it) and the header's
// close button + swipe-down take over.
export function AskFab() {
  const { user } = useAuth();
  const { isOpen, toggleChat, closeChat, seed, clearSeed, focalNoteId, focalNoteTitle } = useAsk();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Swipe-to-dismiss (mobile only). The live gesture values live in refs so the native listeners
  // (attached once per open) never read stale state; dragY/dragging mirror them only for render.
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Native listeners — touchmove must be non-passive so preventDefault() can claim the gesture
  // (React's onTouchMove is passive, where preventDefault is a no-op and the page scroll fights
  // the drag). Re-attached each time the sheet opens, when panelRef points at a fresh node.
  useEffect(() => {
    const node = panelRef.current;
    if (!isOpen || !node) return;

    const isMobile = () => window.matchMedia("(max-width: 639px)").matches;
    let startY: number | null = null;
    let active = false;
    let y = 0;
    const setY = (next: number) => {
      y = next;
      setDragY(next);
    };

    const onStart = (e: TouchEvent) => {
      if (!isMobile()) {
        active = false;
        return;
      }
      const target = e.target as HTMLElement;
      const scroller = node.querySelector<HTMLElement>("[data-scroll]");
      // Engage a dismiss-drag only from the handle/header, or when the message list is at the very
      // top — anywhere else a downward swipe should scroll the conversation as usual.
      const fromZone = !!target.closest("[data-drag-zone]");
      const atTop = (scroller?.scrollTop ?? 0) <= 0;
      active = fromZone || atTop;
      startY = active ? e.touches[0].clientY : null;
    };

    const onMove = (e: TouchEvent) => {
      if (!active || startY === null) return;
      const delta = e.touches[0].clientY - startY;
      if (delta > 0) {
        e.preventDefault(); // own the gesture: no page scroll / rubber-band underneath
        if (!dragging) setDragging(true);
        setY(delta);
      } else if (y !== 0) {
        setY(0);
      }
    };

    const onEnd = () => {
      if (!active) return;
      active = false;
      startY = null;
      setDragging(false);
      if (y > DISMISS_THRESHOLD) {
        // Slide the rest of the way out, then unmount — feels continuous with the flick.
        setY(window.innerHeight);
        window.setTimeout(() => {
          closeChat();
          setY(0);
        }, 240);
      } else {
        setY(0);
      }
    };

    node.addEventListener("touchstart", onStart, { passive: true });
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd);
    node.addEventListener("touchcancel", onEnd);
    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    };
    // `dragging` is intentionally omitted: it would re-attach mid-gesture. The closure reads it
    // only to skip a redundant setState, which stays correct across the listener's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, closeChat]);

  // iOS soft keyboard: lift the sheet's bottom edge to sit just above the keyboard so the
  // input bar floats above it (stays visible) and the message list shrinks to fit — instead
  // of the keyboard covering the input or the page auto-scrolling it out of view. Opening the
  // keyboard shrinks only the *visual* viewport, so we read that gap and pin `bottom` to it.
  // Imperative writes (rAF) avoid re-render churn during momentum scroll; React never manages
  // `bottom`, so these survive drag-driven re-renders. No-op on desktop / without visualViewport.
  useEffect(() => {
    const vv = window.visualViewport;
    const node = panelRef.current;
    if (!isOpen || !vv || !node) return;
    const isMobile = () => window.matchMedia("(max-width: 639px)").matches;
    let raf = 0;
    const apply = () => {
      const gap = isMobile() ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      node.style.bottom = gap > 1 ? `${gap}px` : "";
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };
    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      cancelAnimationFrame(raf);
      node.style.bottom = "";
    };
  }, [isOpen]);

  const hidden = !user || HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  if (hidden) return null;

  return (
    <>
      {isOpen && (
        <>
          {/* Backdrop: dims what's behind. On mobile it's revealed as the sheet is dragged down
              and is a tap-to-close target; on desktop the app stays usable beside the rail, so the
              scrim is hidden there. */}
          <div
            onClick={closeChat}
            aria-hidden
            className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] duration-200 animate-in fade-in-0 sm:hidden"
          />
          {/* Mobile: full-screen sheet (sits just below the safe-area top) with rounded top + grab
              handle, swipe-down to dismiss. Desktop: full-height right rail flush to the edge. */}
          <div
            ref={panelRef}
            data-no-refresh
            role="dialog"
            aria-label="Ask AI"
            style={{
              transform: dragY ? `translateY(${dragY}px)` : undefined,
              transition: dragging ? "none" : "transform 0.24s cubic-bezier(0.32,0.72,0,1)",
            }}
            className="fixed inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 flex flex-col overflow-hidden rounded-t-3xl border-t border-border bg-background shadow-2xl duration-300 animate-in fade-in-0 slide-in-from-bottom-8 sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[440px] sm:max-w-[90vw] sm:rounded-none sm:border-l sm:border-t-0 sm:slide-in-from-right-4 sm:slide-in-from-bottom-0"
          >
            <AskChat
              noteId={focalNoteId}
              noteTitle={focalNoteTitle}
              seed={seed}
              onSeedConsumed={clearSeed}
              onClose={closeChat}
            />
          </div>
        </>
      )}

      {/* The FAB launches the chat. While open, the full-screen sheet (mobile) or rail (desktop)
          covers it, so it's hidden — closing happens via swipe-down or the header's close button. */}
      <button
        type="button"
        onClick={toggleChat}
        aria-label={isOpen ? "Close Ask AI" : "Ask AI"}
        title={isOpen ? "Close Ask AI" : "Ask AI"}
        className={`fixed bottom-8 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-transform active:scale-95 ${
          isOpen ? "hidden" : ""
        }`}
      >
        {isOpen ? <X className="h-6 w-6" /> : <WandSparkles className="h-6 w-6" />}
      </button>
    </>
  );
}
