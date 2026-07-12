import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { RotateCcw, ArrowRight, BookmarkPlus, Loader2, Sparkles } from "lucide-react";
import type { Note, Collection } from "@/lib/types";
import { ingest } from "@/lib/api";
import { useAsk } from "@/contexts/ask-context";
import { FOCUS_RING, PRESS } from "@/lib/ui";
import { ClipMark } from "@/components/ClipMark";
import { ErrorBoundary } from "./ErrorBoundary";
import { NoteHeader } from "./note/NoteHeader";
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
      <span>Limited preview. We couldn't fully process this capture.</span>
      {/* Retry re-ingests the original URL; a typed/uploaded capture has none, so it's hidden. */}
      {note.source_url && (
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-accent disabled:opacity-50"
        >
          <RotateCcw className={`h-3 w-3 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}

// Header for the public /p/{id} view: branded, no owner controls (share/delete) and no
// back-link into the private feed. The wordmark + bottom CTA both route to sign-up.
function PublicNoteHeader({ note }: { note: Note }) {
  return (
    <header className="mb-8 flex flex-col gap-5">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-ink">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-ink text-paper">
          <ClipMark className="h-3.5 w-3.5" />
        </span>
        Clipnote
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={note.content_type} size="md" />
        <SourcePill domain={note.source_domain} url={note.source_url} />
        <span className="text-xs text-ink-soft">{formatDate(note.created_at)}</span>
      </div>
      <h1 className="font-serif text-3xl leading-[1.05] text-ink md:text-5xl">{note.title}</h1>
    </header>
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
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition-transform active:scale-95 disabled:opacity-60"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <BookmarkPlus className="h-4 w-4" />
        )}
        {saving ? "Saving…" : isAuthed ? "Save" : "Save to Clipnote"}
      </button>
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
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-transform active:scale-95 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BookmarkPlus className="h-4 w-4" />
          )}
          {saving ? "Saving…" : isAuthed ? "Save to my notes" : "Sign up to save"}
        </button>
      ) : (
        <Link
          to="/"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-transform active:scale-95"
        >
          Sign up free
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

// Aspect-ratio of the cover decides the hero layout: a wide, sizeable image
// (article/recipe/travel hero) becomes a full-width banner; a square/portrait/small image
// (a creator face or reel thumbnail from a social video) is "compact" and renders as a
// centered contained card so it is never crudely cropped. We measure the image off-screen
// first so the choice doesn't flash. "loading" reuses the banner-shaped fallback; "none"
// covers no-cover and broken images alike.
type CoverKind = "loading" | "none" | "banner" | "compact";

// Returns the layout bucket plus the measured aspect ratio (width / height). The compact
// branch feeds `ratio` into an aspect-ratio box so a portrait cover shows in full instead of
// being cropped into a band.
function useCoverKind(url?: string | null): { kind: CoverKind; ratio: number } {
  const [state, setState] = useState<{ kind: CoverKind; ratio: number }>(
    url ? { kind: "loading", ratio: 1 } : { kind: "none", ratio: 1 },
  );
  useEffect(() => {
    if (!url) {
      setState({ kind: "none", ratio: 1 });
      return;
    }
    setState({ kind: "loading", ratio: 1 });
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const ratio = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      const kind: CoverKind = img.naturalWidth >= 480 && ratio >= 1.3 ? "banner" : "compact";
      setState({ kind, ratio });
    };
    img.onerror = () => live && setState({ kind: "none", ratio: 1 });
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return state;
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

// "Ask about this note" — the per-note launcher for Clip AI. The note-detail route registers
// this note as the Ask focal scope (setFocalNote), so opening the chat here lands scoped to it
// ("this note first, then all") and the chat shows its focal-context UI. Owner view only.
function AskAboutNote() {
  const { openChat } = useAsk();
  return (
    <button
      type="button"
      onClick={() => openChat()}
      aria-label="Ask Clip AI about this note"
      className={`mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent ${PRESS} ${FOCUS_RING}`}
    >
      <Sparkles className="h-4 w-4 text-summary" aria-hidden />
      Ask about this note
    </button>
  );
}

export function NoteContent({
  note,
  collections = [],
  uid = null,
  onDelete,
  onPatch,
  variant = "owner",
  onSave,
  saving,
  isAuthed,
}: {
  note: Note;
  collections?: Collection[];
  uid?: string | null;
  onDelete?: () => void;
  onPatch?: (patch: Partial<Note>) => void;
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
  const { kind: coverKind, ratio: coverRatio } = useCoverKind(
    showHero ? note.cover_image_url : null,
  );
  const url = note.cover_image_url;
  return (
    <article className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-14">
      {isPublic ? (
        <PublicNoteHeader note={note} />
      ) : (
        <NoteHeader
          note={note}
          collections={collections}
          uid={uid}
          onDelete={onDelete}
          onPatch={onPatch}
        />
      )}
      {isPublic && <PublicSaveBar onSave={onSave} saving={saving} isAuthed={isAuthed} />}
      {/* Salvage retry re-ingests via an authed call — hide it on the public view. */}
      {note.is_fallback && !isPublic && <FallbackBanner note={note} />}
      {showHero &&
        (coverKind === "compact" && url ? (
          // Portrait/small cover (reel thumbnail, creator face): a centered, contained card
          // sized to the image's own aspect (clamped), so it reads as a deliberate poster
          // instead of a cropped band or a lonely thumbnail.
          <div className="mb-8 flex justify-center">
            <div
              className={`w-full max-w-[16rem] overflow-hidden rounded-3xl border border-border ${noteAccent(note.content_type).soft}`}
            >
              <img
                src={url}
                alt=""
                style={{ aspectRatio: Math.min(Math.max(coverRatio, 0.62), 1.4) }}
                className="w-full object-cover"
              />
            </div>
          </div>
        ) : coverKind === "banner" && url ? (
          <div className="mb-8 overflow-hidden rounded-3xl border border-border">
            <img src={url} alt="" className="h-56 w-full object-cover md:h-72" />
          </div>
        ) : (
          <CoverFallback note={note} className="mb-8 h-56 w-full md:h-72" />
        ))}
      {/* Per-note Clip AI launcher — owner view only (public viewers can't chat over the corpus). */}
      {!isPublic && <AskAboutNote />}
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
