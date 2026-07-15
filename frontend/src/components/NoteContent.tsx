import { Link } from "@tanstack/react-router";
import { RotateCcw, ArrowRight, BookmarkPlus, Loader2, X } from "lucide-react";
import type { Note } from "@/lib/types";
import { PillButton, PillLink } from "@/components/shared/PillButton";
import { ClipMark } from "@/components/ClipMark";
import { ErrorBoundary } from "./ErrorBoundary";
import { NoteActions, NoteMeta } from "./note/NoteHeader";
import { SmartImage } from "./note/SmartImage";
import { useImageAspect } from "./note/useImageAspect";
import { TypeBadge } from "./note/TypeBadge";
import { SourcePill } from "./note/SourcePill";
import { formatDate, noteAccent, noteIcon } from "@/lib/note-meta";
import { ThoughtsBlock } from "./note/ThoughtsBlock";
import { RecipeNote } from "./note/templates/RecipeNote";
import { ItineraryNote } from "./note/templates/ItineraryNote";
import { ProductNote } from "./note/templates/ProductNote";
import { SummaryNote } from "./note/templates/SummaryNote";
import { WorkoutNote } from "./note/templates/WorkoutNote";
import { PlaceNote } from "./note/templates/PlaceNote";
import { BookNote } from "./note/templates/BookNote";
import { WatchNote } from "./note/templates/WatchNote";
import { GenericNote } from "./note/templates/GenericNote";

// Which bespoke template a note's `data` map was built for. This is a STRUCTURAL fact
// about the data shape — it must never follow the user-editable category (`content_type`),
// or recategorising a note (e.g. "summary" → "business") would swap in a template that
// can't read the existing fields, hiding the note's contents. New notes carry an immutable
// `template` from the backend; for legacy notes that predate it, infer from the data shape.
function resolveTemplate(note: Note): string {
  const data = (note.data ?? {}) as Record<string, unknown>;
  // Entertainment resolves on data shape FIRST: its content_type slug is open (any
  // movies/shows phrasing), so `template` isn't a stable key for it — but `titles[]` of
  // objects is emitted only by the entertainment extraction schema. Older entertainment
  // notes (summary-shaped data, no titles[]) fall through to their stored template.
  if (Array.isArray(data.titles) && data.titles.length > 0 && typeof data.titles[0] === "object")
    return "entertainment";
  if (note.template) return note.template;
  if (Array.isArray(data.ingredients)) return "recipe";
  if (Array.isArray(data.days)) return "itinerary";
  if (Array.isArray(data.exercises) || (data.structure && data.goal)) return "workout";
  if (data.specs || data.pros || data.cons || data.buyUrl || (data.price && data.brand))
    return "product";
  if (data.tldr || Array.isArray(data.keyPoints)) return "summary";
  if (Array.isArray(data.venues)) return "place";
  if (Array.isArray(data.highlights) && (data.location || data.timings)) return "place";
  if (data.premise || data.whoShouldRead || Array.isArray(data.keyIdeas)) return "book";
  return ""; // generic blocks (facts/sections/steps/table/checklist/quotes)
}

function NoteBody({ note, onPatch }: { note: Note; onPatch?: (patch: Partial<Note>) => void }) {
  switch (resolveTemplate(note)) {
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
    case "place":
      return <PlaceNote note={note} />;
    case "book":
      return <BookNote note={note} />;
    case "entertainment":
      return <WatchNote note={note} />;
    default:
      // Any AI-invented type — plus save-as-is typed notes, whose editable `body` block
      // GenericNote renders when onPatch is wired (owner view only).
      return <GenericNote note={note} onPatch={onPatch} />;
  }
}

// Last rung of the render-fallback ladder: title + summary are plain strings, so this
// can't throw on any data shape. The reader still gets the gist plus the source link.
function PlainBody({ note }: { note: Note }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-sm text-ink-soft">
      This note's details couldn't be displayed
      {note.source_url ? (
        <>
          ;{" "}
          <a href={note.source_url} target="_blank" rel="noreferrer" className="underline">
            open the original
          </a>{" "}
          instead.
        </>
      ) : (
        "."
      )}
    </div>
  );
}

// AI-shaped data hitting typed templates is the riskiest render path in the app. The
// ladder degrades per-note instead of white-screening: typed template → GenericNote
// (renders any block shape) → plain card. Each rung reports to /api/client-errors.
function SafeNoteBody({ note, onPatch }: { note: Note; onPatch?: (patch: Partial<Note>) => void }) {
  return (
    <ErrorBoundary
      label={`template:${note.content_type}`}
      fallback={
        <ErrorBoundary label="template:generic-fallback" fallback={<PlainBody note={note} />}>
          <GenericNote note={note} />
        </ErrorBoundary>
      }
    >
      <NoteBody note={note} onPatch={onPatch} />
    </ErrorBoundary>
  );
}

// Salvage notes (backend couldn't process the content) carry is_fallback — offer a
// one-tap re-extract, which re-runs the source through the pipeline and refreshes this note
// in place once the job completes. `retrying` comes from the same route-level state the header
// Re-extract button uses, so the two entry points can't fire overlapping jobs.
function FallbackBanner({
  note,
  onRetry,
  retrying,
}: {
  note: Note;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm text-ink-soft">
      <span>Limited preview. We couldn't fully process this capture.</span>
      {/* Retry re-extracts the original URL; a typed/uploaded capture has none, so it's hidden. */}
      {note.source_url && onRetry && (
        <PillButton
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          className="shrink-0"
        >
          <RotateCcw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? "Re-extracting" : "Retry"}
        </PillButton>
      )}
    </div>
  );
}

// Dismissible banner for a re-extract job that ended in the backend's deliberate failed state
// (a dead source) or a request-level error (429 / network). The note itself was left untouched.
function ReextractErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-ink">
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-full p-1 text-ink-soft transition-colors hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// Top row of the public /p/{id} view: the branded wordmark (routes to sign-up). No owner
// controls and no back-link into the private feed. Mirrors NoteActions' placement so the
// hero layout below is shared between the owner and public variants.
function PublicActions() {
  return (
    <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-ink">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-ink text-paper">
        <ClipMark className="h-3.5 w-3.5" />
      </span>
      Clipnote
    </Link>
  );
}

// Pill row + plain (non-editable) title for the public view — the meta block the shared hero
// layout places either stacked or in a portrait cover's right column.
function PublicMeta({ note }: { note: Note }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={note.content_type} size="md" />
        <SourcePill domain={note.source_domain} url={note.source_url} />
        <span className="text-xs text-ink-soft">{formatDate(note.created_at)}</span>
      </div>
      <h1 className="font-serif text-3xl leading-[1.05] text-ink md:text-5xl">{note.title}</h1>
    </div>
  );
}

// Public-view save controls. Receiver of a shared link can save the note to their own
// Clipnote; the parent route decides what `onSave` does (save it if signed in, else send
// them to sign-up and auto-save on return). Falls back to a plain sign-up nudge when no
// save handler is wired.
interface PublicSaveProps {
  onSave?: () => void;
  saving?: boolean;
  isAuthed?: boolean;
}

// Sticky bar at the top of the public note so "save this" is visible before any scroll.
function PublicSaveBar({ onSave, saving, isAuthed }: PublicSaveProps) {
  if (!onSave) return null;
  return (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <p className="text-sm text-ink-soft">Save this note to your Clipnote.</p>
      <PillButton type="button" onClick={onSave} disabled={saving} className="shrink-0">
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <BookmarkPlus className="h-4 w-4" />
        )}
        {saving ? "Saving…" : isAuthed ? "Save" : "Save to Clipnote"}
      </PillButton>
    </div>
  );
}

// Bottom-of-note conversion prompt shown only on the public view.
function PublicSignupCTA({ onSave, saving, isAuthed }: PublicSaveProps) {
  return (
    <div className="mt-12 flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-serif text-xl text-ink">
          {isAuthed ? "Keep this note" : "Saved with Clipnote"}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          {isAuthed
            ? "Add this note to your own Clipnote so you can come back to it any time."
            : "Turn any link (recipe, video, product, article) into a structured note you'll actually re-read."}
        </p>
      </div>
      {onSave ? (
        <PillButton type="button" onClick={onSave} disabled={saving} className="shrink-0">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BookmarkPlus className="h-4 w-4" />
          )}
          {saving ? "Saving…" : isAuthed ? "Save to my notes" : "Sign up to save"}
        </PillButton>
      ) : (
        <PillLink to="/" className="shrink-0">
          Sign up free
          <ArrowRight className="h-4 w-4" />
        </PillLink>
      )}
    </div>
  );
}

// Gradient + faded type-icon stand-in so the detail view never reads as empty — the same
// accent system the feed cards use (note-meta), scaled up. Used when there's no cover, a
// broken one, or while measuring; also the safety net when an AI cover is capped/disabled.
function CoverFallback({ note, className = "" }: { note: Note; className?: string }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-3xl border border-border ${accent.soft} ${className}`}
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
  onReextract,
  reextracting,
  reextractError,
  onDismissReextractError,
  variant = "owner",
  onSave,
  saving,
  isAuthed,
}: {
  note: Note;
  onDelete?: () => void;
  onPatch?: (patch: Partial<Note>) => void;
  onReextract?: () => void; // owner-only: re-run the source through extraction
  reextracting?: boolean; // true from click until the job completes or fails
  reextractError?: string | null; // set when the job failed or the request itself errored
  onDismissReextractError?: () => void;
  variant?: "owner" | "public";
  onSave?: () => void; // public view: save this shared note to the viewer's account
  saving?: boolean;
  isAuthed?: boolean;
}) {
  const isPublic = variant === "public";
  // ProductNote lays out its own image beside the buy panel — it skips the shared hero.
  // Key off the structural template (not the editable category) so a recategorised
  // product doesn't render both its own image and the shared hero.
  const showHero = resolveTemplate(note) !== "product";
  const url = note.cover_image_url;
  // Measure the cover off-screen so the hero layout is chosen before it paints. A wide cover
  // (ratio >= 1.3) becomes a full-width banner; a portrait/square cover pairs beside the title.
  const { status, ratio } = useImageAspect(showHero ? url : null);
  const hasCover = showHero && !!url && status === "loaded";
  const banner = hasCover && ratio >= 1.3;
  const portrait = hasCover && ratio < 1.3;
  const loadingCover = showHero && !!url && status === "loading";

  const actions = isPublic ? (
    <PublicActions />
  ) : (
    <NoteActions
      note={note}
      onDelete={onDelete}
      onReextract={onReextract}
      reextracting={reextracting}
    />
  );
  const meta = isPublic ? (
    <PublicMeta note={note} />
  ) : (
    <NoteMeta note={note} onPatch={onPatch} />
  );

  return (
    <article className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-14">
      {actions}
      {isPublic && (
        <div className="mt-6">
          <PublicSaveBar onSave={onSave} saving={saving} isAuthed={isAuthed} />
        </div>
      )}
      {/* Re-extract failed (dead source) or the request itself errored — the note was left
          untouched either way. Hidden on the public view (no owner controls there). */}
      {reextractError && !isPublic && onDismissReextractError && (
        <div className="mt-6">
          <ReextractErrorBanner message={reextractError} onDismiss={onDismissReextractError} />
        </div>
      )}
      {/* Salvage retry re-extracts via an authed call — hide it on the public view. */}
      {note.is_fallback && !isPublic && (
        <div className="mt-6">
          <FallbackBanner note={note} onRetry={onReextract} retrying={reextracting} />
        </div>
      )}

      {portrait ? (
        // A single meta block and a single SmartImage, laid out with responsive utilities
        // rather than duplicated CSS-toggled subtrees — two live mounts of NoteMeta would each
        // hold their own EditableTitle/CategoryEditor state and desync across a breakpoint
        // change (rotation, resize) mid-edit. Mobile: meta first, then a full-width 16:9
        // blur-fill cover (DOM order). md+: cover card on the left, meta on the right
        // (order-* flips the visual order without a second mount).
        <div className="mt-6 flex flex-col gap-5 md:flex-row md:items-center md:gap-8">
          <div className="order-2 md:order-1 md:shrink-0">
            <SmartImage
              src={url}
              frameClass="aspect-[16/9] w-full rounded-3xl border border-border md:aspect-[4/5] md:w-56 lg:w-64"
              loading="eager"
            />
          </div>
          <div className="order-1 md:order-2 md:flex-1">{meta}</div>
        </div>
      ) : (
        <>
          <div className="mt-6">{meta}</div>
          {banner ? (
            <div className="mt-8 overflow-hidden rounded-3xl border border-border">
              <img src={url} alt="" className="h-56 w-full object-cover md:h-72" />
            </div>
          ) : loadingCover ? (
            // Hold neutral space while measuring so a real cover doesn't flash the fallback icon.
            <div className="mt-8 h-56 w-full rounded-3xl border border-border bg-card md:h-72" />
          ) : (
            showHero && <CoverFallback note={note} className="mt-8 h-56 w-full md:h-72" />
          )}
        </>
      )}

      <div className="mt-8">
        {/* onPatch is owner-only (undefined on the public view), so the editable body block
            inside GenericNote stays read-only for shared notes. */}
        <SafeNoteBody note={note} onPatch={isPublic ? undefined : onPatch} />
      </div>
      {/* Private annotation — owner view only, at the very bottom of the note. */}
      {!isPublic && (
        <ThoughtsBlock noteId={note.id} value={note.user_note ?? ""} onPatch={onPatch} />
      )}
      {isPublic && <PublicSignupCTA onSave={onSave} saving={saving} isAuthed={isAuthed} />}
    </article>
  );
}
