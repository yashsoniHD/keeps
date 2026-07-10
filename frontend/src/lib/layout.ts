import { useEffect, useState } from "react";

// Feed layout preference, shared between the feed (reads it) and Settings (sets it). Backed by
// localStorage so it persists, and synced live across mounted components via a custom event
// (same-tab) plus the native `storage` event (other tabs).
export type Layout = "standard" | "condensed";

const KEY = "clipnote.layout";
const EVENT = "clipnote:layout";

export function getLayout(): Layout {
  return (localStorage.getItem(KEY) as Layout) || "standard";
}

export function useLayout(): [Layout, (next: Layout) => void] {
  const [layout, setState] = useState<Layout>(getLayout);

  useEffect(() => {
    const sync = () => setState(getLayout());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const set = (next: Layout) => {
    localStorage.setItem(KEY, next);
    setState(next);
    window.dispatchEvent(new Event(EVENT));
  };

  return [layout, set];
}
