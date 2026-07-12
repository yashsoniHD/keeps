// Shared plumbing for the mini-app walls (watchlist / places). Wishlist, Recipes, and Trips
// were removed in the notes-first collapse; this module is the single copy for what remains,
// parameterized only by the app's accent classes (passed as full literal class strings so the
// Tailwind JIT sees them).
import { useCallback, useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { AlertCircle } from "lucide-react";
import type { Unsubscribe } from "firebase/firestore";
import { FOCUS_RING } from "@/lib/ui";
import { PillButton } from "@/components/shared/PillButton";
import { getCached, setCached } from "@/lib/swr-cache";

// Firestore listener page size. The walls were previously hard-capped here with no way to
// see older items; useWallItems raises the limit in steps when the user asks for more.
export const WALL_PAGE_SIZE = 200;

// The item grids (watchlist / places) share one responsive column ramp.
export const WALL_GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

type Watcher<T> = (
  uid: string,
  cb: (items: T[]) => void,
  opts: { max?: number; onError?: (e: Error) => void },
) => Unsubscribe;

// Owns the wall's live listener: error surfacing (a Firestore failure used to leave the
// wall on a perpetual spinner), retry, and load-more past the page cap. `setItems` is
// exposed for the walls' optimistic patchLocal updates.
//
// `cacheKey` (e.g. "watchlist") opts the wall into the SWR cache: the first render seeds from
// the last-seen items (no skeleton on back-navigation) and every update — fresh snapshot or
// optimistic patchLocal — writes through, so the cache stays current.
export function useWallItems<T>(uid: string, watcher: Watcher<T>, cacheKey?: string) {
  const key = cacheKey ? `${cacheKey}:${uid}` : null;
  const [items, setItems] = useState<T[] | null>(() =>
    key ? (getCached<T[]>(key) ?? null) : null,
  );
  const [error, setError] = useState(false);
  const [max, setMax] = useState(WALL_PAGE_SIZE);
  const [attempt, setAttempt] = useState(0);

  // A setter that also warms the cache, used both by the listener and by the walls' optimistic
  // patchLocal — so a title toggled/promoted in the wall survives a round-trip to a detail page.
  const setItemsCached = useCallback<Dispatch<SetStateAction<T[] | null>>>(
    (update) => {
      setItems((prev) => {
        const next =
          typeof update === "function" ? (update as (p: T[] | null) => T[] | null)(prev) : update;
        if (key && next !== null) setCached(key, next);
        return next;
      });
    },
    [key],
  );

  useEffect(() => {
    setError(false);
    return watcher(uid, setItemsCached, { max, onError: () => setError(true) });
  }, [uid, watcher, max, attempt, setItemsCached]);

  return {
    items,
    setItems: setItemsCached,
    error,
    retry: () => setAttempt((n) => n + 1),
    // The listener returned a full page — there may be older items beyond the cap.
    canLoadMore: (items?.length ?? 0) >= max,
    loadMore: () => setMax((m) => m + WALL_PAGE_SIZE),
  };
}

// A compact icon filter: a round button showing only an icon, with the native <select>
// overlaid transparently on top (keeps the native picker + accessibility on every platform).
// The icon fills with the app accent while a non-default value is active. The overlay is
// inset-expanded so the touch target is ≥44px even though the visible circle is 36px.
export function IconSelect({
  icon,
  value,
  active,
  activeClass,
  onChange,
  title,
  children,
}: {
  icon: ReactNode;
  value: string;
  active: boolean;
  activeClass: string; // e.g. "bg-media text-media-on" — full literals for the Tailwind JIT
  onChange: (v: string) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <span
        aria-hidden
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          active ? `border-transparent ${activeClass}` : "border-border bg-card text-ink-soft"
        } ${FOCUS_RING}`}
      >
        {icon}
      </span>
      <select
        aria-label={title}
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute -inset-1 cursor-pointer opacity-0"
      >
        {children}
      </select>
    </div>
  );
}

// Wall load failure (Firestore listener error) — an explicit state with a retry, never a
// perpetual spinner.
export function WallError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <AlertCircle className="mx-auto h-10 w-10 text-ink-soft/50" />
      <p className="mt-4 font-medium text-ink">Couldn’t load your saves</p>
      <p className="mt-1 text-sm text-ink-soft">Check your connection and try again.</p>
      <PillButton type="button" onClick={onRetry} className="mt-5">
        Retry
      </PillButton>
    </div>
  );
}

// Poster-grid skeleton shown while the wall's first snapshot loads — mirrors the card
// shape (image panel + title + sub line) instead of a lone pulsing icon.
export function WallSkeleton({ aspect = "aspect-[4/3]" }: { aspect?: string }) {
  return (
    <div className={WALL_GRID} aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className={`${aspect} animate-pulse rounded-xl border border-border bg-card`} />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-card" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-card" />
        </div>
      ))}
    </div>
  );
}

export function LoadMoreButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center pt-2">
      <button
        type="button"
        onClick={onClick}
        className={`press rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-ink shadow-sm transition-shadow hover:shadow-md ${FOCUS_RING}`}
      >
        Load more
      </button>
    </div>
  );
}
