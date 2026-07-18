// Shared feed order for note-to-note navigation (swipe / prev-next on the note view).
// The feed writes the ordered list of note ids it's currently showing (respecting the active
// category, source filter, pins and search); the note detail reads the neighbours of the note
// being viewed.
//
// Port note: web used sessionStorage (survives feed → note push, cleared on a new session).
// RN has no session concept, so this lives in a small MMKV instance instead — the only visible
// difference is the order persists across cold starts, which is harmless for prev/next.
import { createMMKV } from "react-native-mmkv";

const storage = createMMKV({ id: "clipnote-nav" });
const KEY = "clipnote.feedOrder";

export function setFeedOrder(ids: string[]): void {
  try {
    storage.set(KEY, JSON.stringify(ids));
  } catch {
    // Storage failure — swipe just stays unavailable, no user-facing failure.
  }
}

// The previous/next note ids around `noteId` in the last feed order. Either can be undefined at
// an end of the list, and both are undefined when the note isn't in the stored order (e.g. a
// deep link opened without visiting the feed first).
export function feedNeighbors(noteId: string): { prev?: string; next?: string } {
  try {
    const ids = JSON.parse(storage.getString(KEY) || "[]") as string[];
    const i = ids.indexOf(noteId);
    if (i === -1) return {};
    return {
      prev: i > 0 ? ids[i - 1] : undefined,
      next: i < ids.length - 1 ? ids[i + 1] : undefined,
    };
  } catch {
    return {};
  }
}
