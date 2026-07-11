// Module-level stale-while-revalidate cache for list views backed by live Firestore listeners.
//
// The problem: navigating back to a feed remounts the component and re-subscribes; the first
// snapshot can take seconds, during which the view showed a skeleton even though the user was
// on that feed moments ago. We keep the last-seen data per view key so a remount renders
// instantly from cache and lets the listener revalidate in the background (SWR).
//
// Keys are uid-scoped (e.g. `feed:{uid}:{type}`, `collections:{uid}`, `watchlist:{uid}`) so one
// user's data never leaks into another's; clearCache() runs on sign-out. This is an in-memory
// cache for the life of the tab — it survives client-side navigation (its whole point) but not
// a hard reload, where Firestore's own persistence takes over.

type Entry = { data: unknown; fetchedAt: number };
const store = new Map<string, Entry>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

export function hasCached(key: string): boolean {
  return store.has(key);
}

export function setCached<T>(key: string, data: T): void {
  store.set(key, { data, fetchedAt: Date.now() });
}

// Drop every entry whose key starts with `prefix` (e.g. "feed:" after a note mutation, so a
// deleted or edited note can't flash back from stale cache on the next visit — the live
// listener then repopulates from truth).
export function invalidateCache(prefix: string): void {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

// Wipe everything — called on sign-out so cached data never crosses accounts.
export function clearCache(): void {
  store.clear();
}
