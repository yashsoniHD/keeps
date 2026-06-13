import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getNote } from "@/lib/firestore";
import { NoteContent } from "@/components/NoteContent";
import { AppShell } from "@/components/AppShell";
import type { Note } from "@/lib/types";

// Public, login-free view of a shared note. Firestore rules allow an anonymous read
// only when is_public === true; anything else (private, missing, permission denied)
// collapses to the same "not available" screen — we never reveal whether an id exists.
export const Route = createFileRoute("/p/$noteId")({ component: PublicNote });

function PublicNote() {
  const { noteId } = Route.useParams();
  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    getNote(noteId)
      .then((n) => {
        if (n && n.is_public === true) {
          setNote(n);
          setStatus("ready");
        } else {
          setStatus("unavailable");
        }
      })
      .catch(() => setStatus("unavailable"));
  }, [noteId]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  if (status === "unavailable" || !note) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-paper">
          <Sparkles className="h-6 w-6" />
        </span>
        <p className="text-ink-soft">This note isn't available. It may be private or removed.</p>
        <Link
          to="/"
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper"
        >
          Go to Clipnote
        </Link>
      </div>
    );
  }

  return (
    <AppShell>
      <NoteContent note={note} variant="public" />
    </AppShell>
  );
}
