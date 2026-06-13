import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { RotateCcw, Sparkles, ArrowRight } from "lucide-react";
import type { Note } from "@/lib/types";
import { ingest } from "@/lib/api";
import { ErrorBoundary } from "./ErrorBoundary";
import { NoteHeader } from "./note/NoteHeader";
import { TypeBadge } from "./note/TypeBadge";
import { SourcePill } from "./note/SourcePill";
import { formatDate, noteAccent, noteIcon } from "@/lib/note-meta";
import { AISummaryBlock } from "./note/AISummaryBlock";
import { ThoughtsBlock } from "./note/ThoughtsBlock";
import { RecipeNote } from "./note/templates/RecipeNote";
import { ItineraryNote } from "./note/templates/ItineraryNote";
import { ProductNote } from "./note/templates/ProductNote";
import { SummaryNote } from "./note/templates/SummaryNote";
import { WorkoutNote } from "./note/templates/WorkoutNote";
import { GenericNote } from "./note/templates/GenericNote";

function NoteBody({ note }: { note: Note }) {
  switch (note.content_type) {
    case "recipe":
      return <RecipeNote note={note} />;
    case "itinerary":
      return <ItineraryNote note={note} />;
    case "product":
      return <ProductNote note={note} />;
    case "summary":
      return <SummaryNote note={note} />;
    case "workout":
      return <WorkoutNote note={note} />;
    default:
      return <GenericNote note={note} />; // any AI-invented type
  }
}

// Last rung of the render-fallback ladder: title + summary are plain strings, so this
// can't throw on any data shape. The reader still gets the gist plus the source link.
function PlainBody({ note }: { note: Note }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-sm text-ink-soft">
      This note's details couldn't be displayed;{" "}
      <a href={note.source_url} target="_blank" rel="noreferrer" className="underline">
        open the original
      </a>{" "}
      instead.
    </div>
  );
}

// AI-shaped data hitting typed templates is the riskiest render path in the app. The
// ladder degrades per-note instead of white-screening: typed template → GenericNote
// (renders any block shape) → plain card. Each rung reports to /api/client-errors.
function SafeNoteBody({ note }: { note: Note }) {
  return (
    <ErrorBoundary
      label={`template:${note.content_type}`}
      fallback={
        <ErrorBoundary label="template:generic-fallback" fallback={<PlainBody note={note} />}>
          <GenericNote note={note} />
        </ErrorBoundary>
      }
    >
      <NoteBody note={note} />
    </ErrorBoundary>
  );
}

// Salvage notes (backend couldn't process the content) carry is_fallback — offer a
// one-tap re-ingest, which lands a fresh job/note in the feed.
function FallbackBanner({ note }: { note: Note }) {
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await ingest(note.source_url);
      navigate({ to: "/" });
    } catch {
      setRetrying(false);
    }
  };
  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm text-ink-soft">
      <span>Limited preview. We saved the link, but couldn't process the content.</span>
      <button
        type="button"
        onClick={retry}
        disabled={retrying}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-accent disabled:opacity-50"
      >
        <RotateCcw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}

// Header for the public /p/{id} view: branded, no owner controls (share/delete) and no
// back-link into the private feed. The wordmark + bottom CTA both route to sign-up.
function PublicNoteHeader({ note }: { note: Note }) {
  return (
    <header className="mb-8 flex flex-col gap-5">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-ink text-paper">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        Clip Note
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={note.content_type} size="md" />
        <SourcePill domain={note.source_domain} url={note.source_url} />
        <span className="text-xs text-ink-soft">{formatDate(note.created_at)}</span>
      </div>
      <h1 className="font-serif text-4xl leading-[1.05] text-ink md:text-6xl">{note.title}</h1>
    </header>
  );
}

// Bottom-of-note conversion prompt shown only on the public view.
function PublicSignupCTA() {
  return (
    <div className="mt-12 flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-serif text-xl text-ink">Saved with Clip Note</p>
        <p className="mt-1 text-sm text-ink-soft">
          Turn any link (recipe, video, product, article) into a structured note you'll
          actually re-read.
        </p>
      </div>
      <Link
        to="/"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-transform active:scale-95"
      >
        Sign up free
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

// The note's hero. A real cover image when one exists (and loads); otherwise a styled
// gradient + faded type icon so the detail view never reads as empty — the same accent
// system the feed cards use (note-meta), scaled up. Also the safety net when an AI cover
// is disabled, fails to generate, or hits a daily cap.
function CoverHero({ note }: { note: Note }) {
  const [broken, setBroken] = useState(false);
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const showImage = Boolean(note.cover_image_url) && !broken;

  if (showImage) {
    return (
      <div className="mb-8 overflow-hidden rounded-3xl border border-border">
        <img
          src={note.cover_image_url!}
          alt=""
          className="h-72 w-full object-cover md:h-96"
          onError={() => setBroken(true)} // reveal the gradient fallback below
        />
      </div>
    );
  }

  return (
    <div
      className={`relative mb-8 flex h-56 w-full items-center justify-center overflow-hidden rounded-3xl border border-border md:h-72 ${accent.soft}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-transparent to-ink/[0.06]" />
      <Icon className={`relative h-20 w-20 opacity-40 md:h-28 md:w-28 ${accent.text}`} />
    </div>
  );
}

export function NoteContent({
  note,
  onDelete,
  onPatch,
  variant = "owner",
}: {
  note: Note;
  onDelete?: () => void;
  onPatch?: (patch: Partial<Note>) => void;
  variant?: "owner" | "public";
}) {
  const isPublic = variant === "public";
  // ProductNote lays out its own image beside the buy panel — it skips the shared hero.
  const showHero = note.content_type !== "product";
  return (
    <article className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-14">
      {isPublic ? (
        <PublicNoteHeader note={note} />
      ) : (
        <NoteHeader note={note} onDelete={onDelete} onPatch={onPatch} />
      )}
      {/* Salvage retry re-ingests via an authed call — hide it on the public view. */}
      {note.is_fallback && !isPublic && <FallbackBanner note={note} />}
      {showHero && <CoverHero note={note} />}
      <AISummaryBlock summary={note.ai_summary} />
      <div className="mt-8">
        <SafeNoteBody note={note} />
      </div>
      {/* Private annotation — owner view only, at the very bottom of the note. */}
      {!isPublic && (
        <ThoughtsBlock noteId={note.id} value={note.user_note ?? ""} onPatch={onPatch} />
      )}
      {isPublic && <PublicSignupCTA />}
    </article>
  );
}
