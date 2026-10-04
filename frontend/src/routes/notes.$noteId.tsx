import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ClipLoader } from "@/components/ClipMark";
import { getNote, watchJob } from "@/lib/firestore";
import { deleteNote, reextractNote, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { NoteContent } from "@/components/NoteContent";
import { ErrorState } from "@/components/shared/ErrorState";
import { AppShell } from "@/components/AppShell";
import { feedNeighbors } from "@/lib/note-nav";
import { FOCUS_RING } from "@/lib/ui";
import type { Note } from "@/lib/types";
import { analytics } from "@/lib/analytics";

export const Route = createFileRoute("/notes/$noteId")({ component: NoteDetail });

function NoteDetail() {
  const { noteId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
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
        .then((n) => {
          if (!n || n.user_id !== user.uid) {
            setNotFound(true);
            return;
          }
          setNote(n);
          analytics.noteViewed(n.content_type);
        })
        .catch((err) => {
          // A deleted note or one the user can't read comes back as permission-denied (Firestore
          // rules), not a network error — treat it as not-found rather than blaming the connection.
          const code = (err as { code?: string })?.code;
          if (code === "permission-denied" || code === "not-found") setNotFound(true);
          else setLoadError(true);
        });
    }
  }, [user, noteId]);

  // Re-extract: re-run the note's source through the pipeline (owner-only). The worker
  // overwrites this same note in place, so we watch the job and refetch on completion. Also
  // the real "Retry" behind salvage notes (FallbackBanner). "failed" here is the backend's
  // DELIBERATE outcome for a dead source (the note is left untouched, not a bug) — surfaced
  // to the user via reextractError rather than silently dropped.
  const GENERIC_REEXTRACT_FAILURE = "Re-extract failed. Your note was left unchanged.";
  const [reextracting, setReextracting] = useState(false);
  const [reextractError, setReextractError] = useState<string | null>(null);
  const reextractUnsub = useRef<null | (() => void)>(null);
  const onReextract = useCallback(async () => {
    // Guard against a second job from a repeat click (header button + salvage retry both call
    // this) — each job burns a daily ingest-cap slot.
    if (!user || reextracting) return;
    setReextracting(true);
    setReextractError(null);
    try {
      const { job_id } = await reextractNote(noteId);
      reextractUnsub.current?.(); // drop any prior watcher
      reextractUnsub.current = watchJob(job_id, async (job) => {
        if (job.status !== "completed" && job.status !== "failed") return;
        reextractUnsub.current?.();
        reextractUnsub.current = null;
        setReextracting(false);
        if (job.status === "completed") {
          const n = await getNote(noteId).catch(() => null);
          if (n && n.user_id === user.uid) setNote(n);
        } else {
          setReextractError(GENERIC_REEXTRACT_FAILURE);
        }
      });
    } catch (err) {
      setReextracting(false);
      setReextractError(err instanceof ApiError ? err.message : GENERIC_REEXTRACT_FAILURE);
    }
  }, [user, noteId, reextracting]);

  useEffect(() => () => reextractUnsub.current?.(), []);

  // Swipe / arrow between notes in the feed order the user came from (all or a category). The
  // feed stashes its visible order; we read this note's neighbours. `replace` navigation keeps
  // Back pointing at the feed (with its filter), not at every note swiped through.
  const { prev, next } = useMemo(() => feedNeighbors(noteId), [noteId]);
  const go = useCallback(
    (id?: string) => {
      if (id) navigate({ to: "/notes/$noteId", params: { noteId: id }, replace: true });
    },
    [navigate],
  );

  // Start each note at the top when swiping to the next one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [noteId]);

  // Arrow keys page between notes (ignored while typing in a field / editing text).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") go(prev);
      else if (e.key === "ArrowRight") go(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prev, next]);

  if (loadError) {
    return (
      <ErrorState
        title="Couldn't load this note"
        body="Something went wrong reaching your notes. Give it another try."
        onRetry={() => window.location.reload()}
      />
    );
  }
  if (loading || (!note && !notFound)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ClipLoader className="h-20 w-20" />
      </div>
    );
  }
  if (notFound || !note) {
    return <ErrorState title="Note not found" body="This note doesn't exist or was deleted." />;
  }

  return (
    <AppShell>
      <div>
        <NoteContent
          note={note}
          onPatch={(patch) => setNote((n) => (n ? { ...n, ...patch } : n))}
          onReextract={onReextract}
          reextracting={reextracting}
          reextractError={reextractError}
          onDismissReextractError={() => setReextractError(null)}
          onDelete={async () => {
            await deleteNote(note.id);
            navigate({ to: "/" });
          }}
        />
      </div>

      {/* In-flow footer nav to the neighbouring notes in the feed order the user came from.
          The only note-to-note navigation on mobile (swipe paging was removed on purpose). */}
      {(prev || next) && (
        <nav className="mx-auto flex max-w-4xl items-center justify-between border-t border-border px-5 py-3 md:px-8">
          {prev ? (
            <button
              type="button"
              onClick={() => go(prev)}
              className={`inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button
              type="button"
              onClick={() => go(next)}
              className={`inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </AppShell>
  );
}
