import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { WandSparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { AskChat } from "./AskChat";

// Routes where the Ask-AI FAB has no place: signed-out / public viewer surfaces, plus the
// settings page (account management, not a place to chat).
const HIDDEN_PREFIXES = ["/login", "/share", "/p/", "/settings"];

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
  // Software-keyboard geometry (mobile). `top` re-pins the sheet to the visible viewport after
  // iOS scrolls the layout viewport; `height` shrinks it to sit above the keyboard. See the effect.
  const [kb, setKb] = useState<{ open: boolean; top: number; height: number }>({
    open: false,
    top: 0,
    height: 0,
  });

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

  // Lock the page behind the sheet while it's open (mobile only). This is the keystone of the
  // mobile chat UX: with `<body>` pinned, (1) the feed underneath can no longer be scrolled by a
  // stray touch / overscroll, and (2) — crucially — iOS can't scroll the *layout* viewport to chase
  // the focused input, which was the source of the "chat jumps up" + glitching. With no page scroll,
  // visualViewport.offsetTop stays ~0 and the keyboard effect below collapses to a simple height
  // clamp. We use the iOS-proof `position: fixed` technique (overflow:hidden alone doesn't hold on
  // iOS) and restore the exact scroll position on close. Desktop keeps the app usable beside the rail.
  useEffect(() => {
    if (!isOpen || !window.matchMedia("(max-width: 639px)").matches) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      Object.assign(body.style, prev);
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // iOS soft keyboard: shrink the sheet to the *visible* viewport so the input bar floats just above
  // the keyboard (a `bottom: 0` sheet otherwise sits behind it). With the body locked above, the page
  // no longer scrolls to chase the input, so offsetTop stays ~0 — but we still translate by it as a
  // belt-and-suspenders guard for browsers that ignore the lock. No-op on desktop / where
  // visualViewport is absent. Keyboard open/close is infrequent, so React state (composed with the
  // drag transform in render) is fine — no imperative/React style clash.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!isOpen || !vv) return;
    const isMobile = () => window.matchMedia("(max-width: 639px)").matches;
    const reset = () => setKb((k) => (k.open ? { open: false, top: 0, height: 0 } : k));
    let raf = 0;
    const apply = () => {
      const node = panelRef.current;
      if (!node || !isMobile()) return reset();
      const gap = window.innerHeight - vv.height - vv.offsetTop;
      if (gap <= 1) return reset();
      const topInset = parseFloat(getComputedStyle(node).top) || 0;
      setKb({ open: true, top: vv.offsetTop, height: vv.height - topInset });
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
      reset();
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
            aria-label="Clip AI"
            style={{
              // Drag offset + keyboard re-pin (offsetTop) compose into one translateY; when the
              // keyboard is open we also clamp the sheet's height to the visual viewport.
              transform:
                dragY || kb.open ? `translateY(${dragY + kb.top}px)` : undefined,
              height: kb.open ? `${kb.height}px` : undefined,
              // Snap (no transition) while dragging or while the keyboard is driving the geometry —
              // animating the transform against rapid visualViewport events is what glitches. Keep
              // the easing only for the spring-back after a released drag.
              transition: dragging || kb.open ? "none" : "transform 0.24s cubic-bezier(0.32,0.72,0,1)",
            }}
            className="fixed inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-50 flex flex-col overflow-hidden rounded-t-3xl border-t border-border bg-white shadow-2xl duration-300 animate-in fade-in-0 slide-in-from-bottom-8 sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[440px] sm:max-w-[90vw] sm:rounded-none sm:border-l sm:border-t-0 sm:slide-in-from-right-4 sm:slide-in-from-bottom-0"
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
        aria-label={isOpen ? "Close Clip AI" : "Clip AI"}
        title={isOpen ? "Close Clip AI" : "Clip AI"}
        className={`fixed bottom-8 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-transform active:scale-95 ${
          isOpen ? "hidden" : ""
        }`}
      >
        {isOpen ? <X className="h-6 w-6" /> : <WandSparkles className="h-6 w-6" />}
      </button>
    </>
  );
}
