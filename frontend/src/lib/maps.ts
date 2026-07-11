import { useEffect, useState } from "react";

// Shared Google Maps JS API load-failure tracking, used by every map component (VenuesMap,
// TripMap x2, PlacesMap) instead of each wiring its own detection.
//
// Two distinct failure modes need covering:
// - the loader script itself failing to fetch/execute — surfaces as the `<APIProvider onError>`
//   callback rejecting.
// - a key that loads fine but is rejected at runtime (RefererNotAllowedMapError, billing not
//   enabled, etc) — Google calls the global `window.gm_authFailure` callback for this, *after*
//   the script has already loaded, so `onError` alone never sees it and nothing throws for an
//   ErrorBoundary to catch.
//
// Wiring `gm_authFailure` is only safe to do once per page (it's a single global slot), so it's
// registered here at module load and fanned out to every subscribed component.

let failed = false;
const listeners = new Set<() => void>();

function markFailed() {
  if (failed) return;
  failed = true;
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  const w = window as typeof window & { gm_authFailure?: () => void };
  const prevAuthFailure = w.gm_authFailure;
  w.gm_authFailure = () => {
    prevAuthFailure?.();
    markFailed();
  };
}

// Pass as `<APIProvider onError={reportMapsLoadError}>` to catch loader-script failures.
export function reportMapsLoadError() {
  markFailed();
}

// True once the Maps JS API has failed to load or been auth-rejected, anywhere on the page.
// Map components should render their "map unavailable" notice instead of the dead container.
export function useMapsLoadFailed(): boolean {
  const [state, setState] = useState(failed);
  useEffect(() => {
    if (failed) {
      setState(true);
      return;
    }
    const listener = () => setState(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}
