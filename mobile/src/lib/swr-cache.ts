// Stale-while-revalidate cache for list views backed by live Firestore listeners.
//
// The problem: navigating back to a feed remounts the component and re-subscribes; the first
// snapshot can take a moment, during which the view shows a skeleton even though the user was
// on that feed moments ago. We keep the last-seen data per view key so a remount renders
// instantly from cache and lets the listener revalidate in the background (SWR).
//
// Keys are uid-scoped (e.g. `feed:{uid}:{type}`, `collections:{uid}`, `watchlist:{uid}`) so one
// user's data never leaks into another's; clearCache() runs on sign-out.
//
// Port note: the web version held everything in an in-memory Map for the life of the tab. Here
// the persisted values live in MMKV (id "clipnote-cache") so a warm-start after the OS kills the
// app still renders instantly. In-flight fetch promises are NOT serialisable, so `inflight` stays
// an in-memory Map exactly as on web.
import { createMMKV } from "react-native-mmkv";

const storage = createMMKV({ id: "clipnote-cache" });

type Entry = { data: unknown; fetchedAt: number };
// In-flight fetches for getOrFetch(), keyed the same way — dedupes concurrent callers (e.g.
// GettingStarted + Settings both mounting) onto one request instead of firing N of them.
const inflight = new Map<string, Promise<unknown>>();

// Default freshness window for fetch-through reads (getOrFetch). Listener-backed views
// (feed/collections) don't pass a maxAge — their getCached() call always returns whatever's
// cached and the live listener revalidates; fetch-through reads with no listener get this TTL.
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function readEntry(key: string): Entry | undefined {
  const raw = storage.getString(key);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as Entry;
  } catch {
    return undefined;
  }
}

// `maxAgeMs` is opt-in: listener-backed callers omit it and always get the cached value (the
// listener is the revalidation), while fetch-through callers pass a TTL to expire stale data.
export function getCached<T>(key: string, maxAgeMs?: number): T | undefined {
  const entry = readEntry(key);
  if (!entry) return undefined;
  if (maxAgeMs !== undefined && Date.now() - entry.fetchedAt > maxAgeMs) return undefined;
  return entry.data as T;
}

export function hasCached(key: string): boolean {
  return storage.contains(key);
}

export function setCached<T>(key: string, data: T): void {
  storage.set(key, JSON.stringify({ data, fetchedAt: Date.now() } satisfies Entry));
}

// Fetch-through cache for reads with NO live listener (e.g. the PAT list): returns fresh
// cached data within `maxAgeMs`, otherwise fetches once — concurrent callers for the same key
// share the single in-flight promise. A rejected fetch is not cached (callers still see the
// error). Invalidate via invalidateCache() from the corresponding mutators.
export function getOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  maxAgeMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const cached = getCached<T>(key, maxAgeMs);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fetcher()
    .then((data) => {
      setCached(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

// Drop every entry whose key starts with `prefix` (e.g. "feed:" after a note mutation, so a
// deleted or edited note can't flash back from stale cache on the next visit — the live
// listener then repopulates from truth). Also clears any matching in-flight fetch so a
// mutation mid-flight can't leave the pre-mutation result cached.
export function invalidateCache(prefix: string): void {
  for (const key of storage.getAllKeys()) if (key.startsWith(prefix)) storage.remove(key);
  for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
}

// Wipe everything — called on sign-out so cached data never crosses accounts.
export function clearCache(): void {
  storage.clearAll();
  inflight.clear();
}
