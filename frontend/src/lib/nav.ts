import type { useNavigate } from "@tanstack/react-router";
import type { JobDestination } from "@/lib/types";

// Navigation helpers for the note-OR-item world: a saved thing is either a plain note
// (/notes/$noteId) or a mini-app item (/<app>/$itemId). TanStack's `navigate` needs LITERAL
// route paths (its param types are keyed off them), so we branch here instead of passing a
// dynamic string — keeping every call site type-safe.
type Navigate = ReturnType<typeof useNavigate>;

// Open a search hit / citation: an item when `app` is set, else a note. `id` is the underlying
// doc id (ref_id for items, note id for notes).
export function goToHit(navigate: Navigate, app: string | null | undefined, id: string): void {
  switch (app) {
    case "watchlist":
      navigate({ to: "/watchlist/$itemId", params: { itemId: id } });
      return;
    case "wishlist":
      navigate({ to: "/wishlist/$itemId", params: { itemId: id } });
      return;
    case "places":
      navigate({ to: "/places/$itemId", params: { itemId: id } });
      return;
    case "recipes":
      navigate({ to: "/recipes/$itemId", params: { itemId: id } });
      return;
    case "trips":
      navigate({ to: "/trips/$itemId", params: { itemId: id } });
      return;
    default:
      navigate({ to: "/notes/$noteId", params: { noteId: id } });
  }
}

// Open a mini-app's index (landing page) — used when a capture produced several items.
export function goToApp(navigate: Navigate, app: string): void {
  switch (app) {
    case "watchlist":
      navigate({ to: "/watchlist" });
      return;
    case "wishlist":
      navigate({ to: "/wishlist" });
      return;
    case "places":
      navigate({ to: "/places" });
      return;
    case "recipes":
      navigate({ to: "/recipes" });
      return;
    case "trips":
      navigate({ to: "/trips" });
      return;
    default:
      navigate({ to: "/" });
  }
}

// Route a freshly-completed capture to where it landed. Mini-app captures produce items (route
// to the item, or the app index when several were produced); everything else is a note. Falls
// back to `note_id` for jobs written before `destination` existed.
export function goToDestination(
  navigate: Navigate,
  dest: JobDestination | null | undefined,
  fallbackNoteId?: string | null,
): void {
  if (dest?.kind === "app" && dest.app) {
    if (dest.item_id) goToHit(navigate, dest.app, dest.item_id);
    else goToApp(navigate, dest.app);
    return;
  }
  const noteId = dest?.note_id || fallbackNoteId;
  if (noteId) navigate({ to: "/notes/$noteId", params: { noteId } });
}
