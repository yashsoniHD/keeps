import { useEffect } from "react";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { isIOS, isStandalone } from "@/lib/platform";

const EDGE = 24; // px from the left edge where a swipe may start
const COMMIT_FRACTION = 0.35;
const FLICK_VELOCITY = 0.5; // px/ms
const NO_SWIPE_ROUTES = new Set(["/", "/login"]);

function scrollsHorizontally(start: EventTarget | null) {
  for (let el = start as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof Element)) return false; // document/window have no computed style
    if (el.scrollWidth <= el.clientWidth) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === "auto" || ox === "scroll") return true;
  }
  return false;
}

function isTextEntry(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el?.closest?.("input, textarea, select, [contenteditable]");
}

// iOS-style edge swipe back for installed PWAs (standalone iOS has no native one).
// `ref` is the route container that follows the finger (transform only, driven by rAF).
export function useEdgeSwipeBack(ref: React.RefObject<HTMLElement | null>) {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Browser tabs / Android already have an OS back gesture; ours would double-fire there.
    if (!isStandalone() || !isIOS()) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let samples: { t: number; x: number }[] = []; // recent moves, for release velocity
    let shade: HTMLDivElement | null = null; // dims the blank area the page slides off
    let mode: "none" | "pending" | "drag" = "none";
    let raf = 0;

    const reset = () => {
      mode = "none";
      cancelAnimationFrame(raf);
      el.style.transition = "";
      el.style.transform = "";
      el.style.boxShadow = "";
      el.style.willChange = "";
      el.style.position = "";
      el.style.zIndex = "";
      shade?.remove();
      shade = null;
      document.removeEventListener("touchmove", onMove);
    };
    const paint = () => {
      raf = 0;
      el.style.transform = `translate3d(${dx}px,0,0)`;
      if (shade) shade.style.opacity = String(0.25 * (1 - dx / window.innerWidth));
    };
    const goBack = () => {
      // Our slide is the transition; suppress the router's view transition for this nav.
      document.documentElement.dataset.swipe = "1";
      setTimeout(() => delete document.documentElement.dataset.swipe, 400);
      if (canGoBack) router.history.back();
      else router.navigate({ to: "/" });
    };

    const onStart = (e: TouchEvent) => {
      mode = "none";
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE || NO_SWIPE_ROUTES.has(router.state.location.pathname)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (getSelection()?.toString()) return;
      if (isTextEntry(e.target) || scrollsHorizontally(e.target)) return;
      x0 = t.clientX;
      y0 = t.clientY;
      dx = 0;
      samples = [{ t: e.timeStamp, x: 0 }];
      mode = "pending";
      // Non-passive only for edge touches, so ordinary scrolls never wait on the main thread.
      document.addEventListener("touchmove", onMove, { passive: false });
    };
    const onMove = (e: TouchEvent) => {
      if (mode === "none") return;
      const t = e.touches[0];
      const mx = t.clientX - x0;
      const my = t.clientY - y0;
      if (mode === "pending") {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        if (mx <= 0 || Math.abs(my) > Math.abs(mx)) {
          mode = "none"; // vertical: leave scroll / pull-to-refresh alone
          return document.removeEventListener("touchmove", onMove);
        }
        mode = "drag";
        if (!reduced.matches) {
          el.style.willChange = "transform";
          el.style.boxShadow = "-12px 0 32px rgba(0,0,0,.18)";
          el.style.position = "relative";
          el.style.zIndex = "1";
          shade = document.createElement("div");
          shade.style.cssText =
            "position:fixed;inset:0;background:#000;opacity:.25;pointer-events:none";
          el.before(shade);
        }
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, mx);
      samples.push({ t: e.timeStamp, x: dx });
      while (samples.length > 2 && e.timeStamp - samples[1].t > 50) samples.shift();
      if (!reduced.matches && !raf) raf = requestAnimationFrame(paint);
    };
    const onEnd = (e: TouchEvent) => {
      document.removeEventListener("touchmove", onMove);
      if (mode !== "drag") return void (mode = "none");
      const w = window.innerWidth;
      // Velocity over the last ~50 ms, so a slow drag that ends in a flick still commits.
      const s0 = samples[0];
      const fast = (dx - s0.x) / Math.max(1, e.timeStamp - s0.t) > FLICK_VELOCITY && dx > 30;
      const commit = dx > w * COMMIT_FRACTION || fast;
      cancelAnimationFrame(raf);
      mode = "none";
      if (reduced.matches) {
        if (commit) goBack();
        return;
      }
      el.style.transition = "transform 180ms cubic-bezier(.2,.8,.2,1)";
      el.style.transform = `translate3d(${commit ? w : 0}px,0,0)`;
      if (shade) {
        shade.style.transition = "opacity 180ms cubic-bezier(.2,.8,.2,1)";
        shade.style.opacity = commit ? "0" : ".25";
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener("transitionend", finish);
        if (!commit) return reset();
        goBack();
        // keep the old page off-screen until the previous route has rendered
        const off = router.subscribe("onResolved", () => {
          off();
          requestAnimationFrame(reset);
        });
        setTimeout(reset, 600);
      };
      el.addEventListener("transitionend", finish);
      setTimeout(finish, 250);
    };
    const onCancel = () => {
      document.removeEventListener("touchmove", onMove);
      if (mode === "drag") reset();
      mode = "none";
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      reset();
    };
  }, [ref, router, canGoBack]);
}
