import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ClipLoader } from "@/components/ClipMark";
import { getNote, getAnnotation, watchJob } from "@/lib/firestore";
import { deleteNote, reextractNote, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { useCategoryMeta } from "@/contexts/category-meta";
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
        .catch((err) => {
          // A deleted note or one the user can't read comes back as permission-denied (Firestore
          // rules), not a network error — treat it as not-found rather than blaming the connection.
          const code = (err as { code?: string })?.code;
          if (code === "permission-denied" || code === "not-found") setNotFound(true);
          else setLoadError(true);
        });
    }
  }, [user, noteId]);

  // Scope the global Ask-AI FAB to this note while it's open ("this note first, then all").
  useEffect(() => {
    if (note) setFocalNote({ id: note.id, title: note.title });
    return () => setFocalNote(null);
  }, [note, setFocalNote]);

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
          if (n && n.user_id === user.uid) {
            const userNote = await getAnnotation(noteId).catch(() => "");
            setNote({ ...n, user_note: userNote });
          }
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

  // Horizontal touch swipe (mobile). Require clear horizontal intent so it doesn't fight
  // vertical scrolling or a horizontal scroller inside the note (map, table).
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? next : prev);
  };

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
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
          The feed only stashes ids (not titles), so the cards use plain labels. Mobile still
          pages by swiping. */}
      {(prev || next) && (
        <nav className="mx-auto grid max-w-4xl grid-cols-2 gap-3 px-5 pb-10 md:px-8">
          {prev ? (
            <button
              type="button"
              onClick={() => go(prev)}
              className={`flex flex-col gap-1 rounded-2xl border border-border bg-card p-4 text-left transition-shadow hover:shadow-md ${FOCUS_RING}`}
            >
              <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-ink-soft">
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </span>
              <span className="line-clamp-2 font-serif text-lg text-ink">Previous note</span>
            </button>
          ) : (
            <div />
          )}
          {next ? (
            <button
              type="button"
              onClick={() => go(next)}
              className={`flex flex-col items-end gap-1 rounded-2xl border border-border bg-card p-4 text-right transition-shadow hover:shadow-md ${FOCUS_RING}`}
            >
              <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-ink-soft">
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
              <span className="line-clamp-2 font-serif text-lg text-ink">Next note</span>
            </button>
          ) : (
            <div />
          )}
        </nav>
      )}
    </AppShell>
  );
}
