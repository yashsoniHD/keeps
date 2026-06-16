import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getNote, getAnnotation, deleteNote } from "@/lib/firestore";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import { NoteContent } from "@/components/NoteContent";
import { AppShell } from "@/components/AppShell";
import type { Note } from "@/lib/types";
import { analytics } from "@/lib/analytics";

export const Route = createFileRoute("/notes/$noteId")({ component: NoteDetail });

function NoteDetail() {
  const { noteId } = Route.useParams();
  const { user, loading } = useAuth();
  useCategoryMeta(); // reflect category icon/colour overrides on the note view + badge
  const navigate = useNavigate();
  const { setFocalNote } = useAsk();
  const [note, setNote] = useState<Note | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // Preserve the destination: after sign-in the login page replays this path,
    // so a shared /notes/… link doesn't dump a signed-out user on the feed.
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: `/notes/${noteId}` } });
    }
  }, [user, loading, navigate, noteId]);

  useEffect(() => {
    if (user && noteId) {
      setLoadError(false);
      getNote(noteId)
        .then(async (n) => {
          if (!n || n.user_id !== user.uid) {
            setNotFound(true);
            return;
          }
          // Merge the private annotation (separate owner-only doc) onto the note.
          const userNote = await getAnnotation(noteId).catch(() => "");
          setNote({ ...n, user_note: userNote });
          analytics.noteViewed(n.content_type);
        })
        .catch(() => setLoadError(true));
    }
  }, [user, noteId]);

  // Scope the global Ask-AI FAB to this note while it's open ("this note first, then all").
  useEffect(() => {
    if (note) setFocalNote({ id: note.id, title: note.title });
    return () => setFocalNote(null);
  }, [note, setFocalNote]);

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-ink-soft">
        <span>Couldn't load this note. Check your connection.</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-ink"
        >
          Retry
        </button>
      </div>
    );
  }
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
        onPatch={(patch) => setNote((n) => (n ? { ...n, ...patch } : n))}
        onDelete={async () => {
          await deleteNote(note.id);
          navigate({ to: "/" });
        }}
      />
    </AppShell>
  );
}
