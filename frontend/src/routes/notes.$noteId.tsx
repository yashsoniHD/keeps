import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getNote, watchJob } from "@/lib/firestore";
import { reextractNote, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { ErrorState } from "@/components/shared/ErrorState";
import { toView } from "@/keeps/toView";
import { NoteActions } from "@/keeps/NoteActions";
import { CategoryChip, Icon, IconButton, Thumbnail } from "@/keeps/ui";
import { NoteBody } from "@/keeps/templates/NoteBody";
import { peekNote } from "@/keeps/noteCache";
import { feedNeighbors } from "@/lib/note-nav";
import type { Note } from "@/lib/types";
import { analytics } from "@/lib/analytics";

export const Route = createFileRoute("/notes/$noteId")({ component: NoteDetail });

function NoteDetail() {
  const { noteId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // Seeded from the library's live cache so the page paints instantly; getNote revalidates.
  const [note, setNote] = useState<Note | null>(() => {
    const cached = peekNote(noteId);
    return cached && cached.user_id === user?.uid ? cached : null;
  });
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    // Preserve the destination: after sign-in the login page replays this path,
    // so a shared /notes/… link doesn't dump a signed-out user on the feed.
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: `/notes/${noteId}` } });
    }
  }, [user, loading, navigate, noteId]);

  useEffect(() => {
    if (user && noteId) {
      let stale = false; // a slow fetch for the previous note must not overwrite this one
      setLoadError(false);
      setNotFound(false);
      // Paging to a new note: show its cached copy (only ever the user's own) or the spinner,
      // never the previous note under the new URL.
      setNote((cur) => {
        if (cur?.id === noteId && cur.user_id === user.uid) return cur;
        const cached = peekNote(noteId);
        return cached && cached.user_id === user.uid ? cached : null;
      });
      getNote(noteId)
        .then((n) => {
          if (stale) return;
          if (!n || n.user_id !== user.uid) {
            setNotFound(true);
            return;
          }
          setNote(n);
          analytics.noteViewed(n.content_type);
        })
        .catch((err) => {
          if (stale) return;
          // A deleted note or one the user can't read comes back as permission-denied (Firestore
          // rules), not a network error — treat it as not-found rather than blaming the connection.
          const code = (err as { code?: string })?.code;
          if (code === "permission-denied" || code === "not-found") setNotFound(true);
          else setLoadError(true);
        });
      return () => {
        stale = true;
      };
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
    setActionsOpen(false); // the sheet holds the previous note's edit state
  }, [noteId]);

  // Arrow keys page between notes (ignored while typing in a field / editing text).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return; // sheet open: don't page
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") go(prev);
      else if (e.key === "ArrowRight") go(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prev, next]);

  if (loadError && !note) {
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
      <div
        className="flex min-h-screen items-center justify-center"
        role="status"
        aria-label="Loading"
      >
        <Loader2 size={28} className="spin" aria-hidden="true" />
      </div>
    );
  }
  if (notFound || !note) {
    return <ErrorState title="Note not found" body="This note doesn't exist or was deleted." />;
  }

  const view = toView(note);
  const age = view.age && view.age.charAt(0).toLowerCase() + view.age.slice(1); // "3 Oct" stays
  // Back to wherever the user came from inside the app; otherwise the library.
  const back = () => (canGoBack ? router.history.back() : navigate({ to: "/" }));

  return (
    <div className="app-shell">
      <main className="main">
        <div className="reader">
          <div className="reader-toolbar">
            <button type="button" className="text-button muted" onClick={back}>
              <Icon name="ChevronLeft" />
              Back to library
            </button>
            <div className="row">
              {/^https?:\/\//i.test(view.url) && (
                <a
                  className="platform-source"
                  href={view.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open on ${view.platform}`}
                >
                  {view.platform}
                  <Icon name="ArrowUpRight" size={14} />
                </a>
              )}
              <IconButton
                icon="MoreHorizontal"
                label="Note actions"
                onClick={() => setActionsOpen(true)}
              />
            </div>
          </div>

          {loadError && (
            <div className="notice" role="status">
              Couldn't refresh this note. Showing the saved copy.
            </div>
          )}
          {reextracting && (
            <div className="notice" role="status">
              <Loader2 size={16} className="spin" aria-hidden="true" />
              Regenerating this note from the source. This can take a minute.
            </div>
          )}
          {reextractError && (
            <div className="notice" role="alert">
              {reextractError}
              <button type="button" className="text-button" onClick={() => setReextractError(null)}>
                Dismiss
              </button>
            </div>
          )}
          {view.thin && !reextracting && (
            <div className="notice" role="status">
              Only the caption could be read.
              <button type="button" className="text-button" onClick={onReextract}>
                Regenerate
              </button>
            </div>
          )}

          <div className="note-heading">
            <Thumbnail note={view} large />
            <div>
              <h1>{view.title}</h1>
              {view.categorySlug && (
                <div className="t-heading-chip">
                  <CategoryChip slug={view.categorySlug} label={view.category} />
                </div>
              )}
              {(age || view.creator) && (
                <p className="saved-caption">
                  {age && <>Saved {age}</>}
                  {age && view.creator && " · "}
                  {view.creator}
                </p>
              )}
            </div>
          </div>
          {view.summary && (
            <section className="in-short">
              <h2>In short</h2>
              <p>{view.summary}</p>
            </section>
          )}
          <NoteBody key={`${view.id}:${note.updated_at?.toMillis?.() ?? ""}`} view={view} />

          {(prev || next) && (
            <nav className="reader-pager">
              {prev ? (
                <button type="button" className="text-button muted" onClick={() => go(prev)}>
                  <Icon name="ChevronLeft" />
                  Previous
                </button>
              ) : (
                <span />
              )}
              {next ? (
                <button type="button" className="text-button muted" onClick={() => go(next)}>
                  Next
                  <Icon name="ChevronRight" />
                </button>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </main>
      {actionsOpen && (
        <NoteActions
          key={view.id}
          view={view}
          onClose={() => setActionsOpen(false)}
          onDeleted={() => navigate({ to: "/" })}
          onUpdated={(patch) => setNote((n) => (n ? { ...n, ...patch } : n))}
          onReextract={onReextract}
        />
      )}
    </div>
  );
}
