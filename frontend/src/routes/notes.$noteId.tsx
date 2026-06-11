import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getNote, deleteNote } from "@/lib/firestore";
import { useAuth } from "@/contexts/auth-context";
import { NoteContent } from "@/components/NoteContent";
import { AppShell } from "@/components/AppShell";
import type { Note } from "@/lib/types";

export const Route = createFileRoute("/notes/$noteId")({ component: NoteDetail });

function NoteDetail() {
  const { noteId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user && noteId) {
      getNote(noteId).then((n) => {
        if (!n || n.user_id !== user.uid) setNotFound(true);
        else setNote(n);
      });
    }
  }, [user, noteId]);

  if (loading || (!note && !notFound)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }
  if (notFound || !note) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-soft">
        Note not found.
      </div>
    );
  }

  return (
    <AppShell>
      <NoteContent
        note={note}
        onDelete={async () => {
          await deleteNote(note.id);
          navigate({ to: "/" });
        }}
      />
    </AppShell>
  );
}
