import type { useNavigate } from "@tanstack/react-router";
import type { JobDestination } from "@/lib/types";

// Navigation helpers for the notes-first world: every saved thing is a note at
// /notes/$noteId. TanStack's `navigate` needs LITERAL route paths (its param types are
// keyed off them), so the helpers centralize that.
type Navigate = ReturnType<typeof useNavigate>;

// Open a search hit / citation / recent save by its note id.
export function goToNote(navigate: Navigate, noteId: string): void {
  navigate({ to: "/notes/$noteId", params: { noteId } });
}

// Route a freshly-completed capture to its note. Falls back to `note_id` for jobs written
// before `destination` existed.
export function goToDestination(
  navigate: Navigate,
  dest: JobDestination | null | undefined,
  fallbackNoteId?: string | null,
): void {
  const noteId = dest?.note_id || fallbackNoteId;
  if (noteId) goToNote(navigate, noteId);
}
