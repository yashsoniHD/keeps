import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { getNote } from "@/lib/firestore";
import { saveSharedNote } from "@/lib/api";
import { NoteContent } from "@/components/NoteContent";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/auth-context";
import { setSignupRef } from "@/lib/attribution";
import type { Note } from "@/lib/types";

// Public, login-free view of a shared note. Firestore rules allow an anonymous read
// only when is_public === true; anything else (private, missing, permission denied)
// collapses to the same "not available" screen — we never reveal whether an id exists.
export const Route = createFileRoute("/p/$noteId")({
  component: PublicNote,
  validateSearch: (search: Record<string, unknown>) => ({
    // Set when the viewer signed in to save and got redirected back — triggers auto-save.
    save: search.save === "1" || search.save === 1 ? true : undefined,
  }),
});

function PublicNote() {
  const { noteId } = Route.useParams();
  const { save } = Route.useSearch();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Guard the post-login auto-save so a failure doesn't retry in a loop.
  const autoSaveTried = useRef(false);

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

  const doSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { id } = await saveSharedNote(noteId);
      // Land them on their own (private) copy in the authed app.
      navigate({ to: "/notes/$noteId", params: { noteId: id } });
    } catch {
      setSaving(false);
      setSaveError("Couldn't save the note. Please try again.");
    }
  }, [noteId, navigate]);

  // Save handler for the buttons: signed in → save directly; otherwise send to sign-in
  // with a redirect that comes back here with ?save=1 so we finish the save automatically.
  const onSave = useCallback(() => {
    if (user) {
      void doSave();
    } else {
      // Attribute this signup to the shared-note viral loop before bouncing to sign-in.
      setSignupRef("shared-note");
      navigate({ to: "/login", search: { redirect: `/p/${noteId}?save=1` } });
    }
  }, [user, doSave, navigate, noteId]);

  // Returned from sign-in with the save intent — finish what they started, once.
  useEffect(() => {
    if (save && user && !authLoading && status === "ready" && !autoSaveTried.current) {
      autoSaveTried.current = true;
      void doSave();
    }
  }, [save, user, authLoading, status, doSave]);

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
      <NoteContent
        note={note}
        variant="public"
        onSave={onSave}
        saving={saving}
        isAuthed={!!user}
      />
      {saveError && (
        <p className="mx-auto max-w-4xl px-5 pb-8 text-sm text-destructive md:px-8">{saveError}</p>
      )}
      {!user && (
        <div className="mx-auto max-w-4xl px-5 pb-12 md:px-8">
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-card p-7 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="font-serif text-xl text-ink">Made with Clipnote</p>
              <p className="mt-1 text-sm text-ink-soft">
                Turn any link — recipe, reel, product, article — into a structured note like this.
              </p>
            </div>
            <Link
              to="/landing"
              search={{ ref: "shared-note" }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" />
              Start your own — free
            </Link>
          </div>
        </div>
      )}
    </AppShell>
  );
}
