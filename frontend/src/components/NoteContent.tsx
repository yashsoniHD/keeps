import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import type { Note } from "@/lib/types";
import { ingest } from "@/lib/api";
import { ErrorBoundary } from "./ErrorBoundary";
import { NoteHeader } from "./note/NoteHeader";
import { AISummaryBlock } from "./note/AISummaryBlock";
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
      This note's details couldn't be displayed —{" "}
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
      <span>Limited preview — we saved the link, but couldn't process the content.</span>
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

export function NoteContent({ note, onDelete }: { note: Note; onDelete?: () => void }) {
  // ProductNote lays out its own image beside the buy panel.
  const showCover = note.cover_image_url && note.content_type !== "product";
  return (
    <article className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-14">
      <NoteHeader note={note} onDelete={onDelete} />
      {note.is_fallback && <FallbackBanner note={note} />}
      {showCover && (
        <div className="mb-8 overflow-hidden rounded-3xl border border-border">
          <img
            src={note.cover_image_url!}
            alt=""
            className="h-72 w-full object-cover md:h-96"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
            }}
          />
        </div>
      )}
      <AISummaryBlock summary={note.ai_summary} />
      <div className="mt-8">
        <SafeNoteBody note={note} />
      </div>
    </article>
  );
}
