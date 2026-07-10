// Shared feed order for note-to-note navigation (swipe / arrow keys on the note view).
// The feed writes the ordered list of note ids it's currently showing (respecting the active
// category, source filter, pins and search); the note detail reads the neighbours of the note
// being viewed. sessionStorage so it survives the feed → note push but not a new session.

const KEY = "clipnote.feedOrder";

export function setFeedOrder(ids: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Private mode / quota — swipe just stays unavailable, no user-facing failure.
  }
}

// The previous/next note ids around `noteId` in the last feed order. Either can be undefined at
// an end of the list, and both are undefined when the note isn't in the stored order (e.g. a
// deep link opened without visiting the feed first).
export function feedNeighbors(noteId: string): { prev?: string; next?: string } {
  try {
    const ids = JSON.parse(sessionStorage.getItem(KEY) || "[]") as string[];
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
