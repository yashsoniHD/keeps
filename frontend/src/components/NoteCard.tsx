import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Trash2,
  Loader2,
  AlertCircle,
  RotateCcw,
  WifiOff,
  Clock,
  X,
} from "lucide-react";
import type { Note, Job } from "@/lib/types";
import { formatDateShort, noteAccent, noteIcon, noteLabel, sourceLabel } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { WithNoteMenu } from "@/components/NoteContextMenu";
import { SaveSnap } from "@/components/ClipMark";

// One debounced window-resize notifier shared by every card. Card width only changes when
// the viewport does (the responsive column count), so a lone resize listener replaces the
// previous per-card ResizeObserver — dozens of live observers doing layout work on a full feed.
// Backend job error codes -> user-facing copy.
const JOB_ERRORS: Record<string, string> = {
  private_or_blocked:
    "This post is private or Instagram blocked access. Try sharing a public link.",
};

const resizeCallbacks = new Set<() => void>();
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => resizeCallbacks.forEach((cb) => cb()), 150);
  });
}
function onSharedResize(cb: () => void): () => void {
  resizeCallbacks.add(cb);
  return () => resizeCallbacks.delete(cb);
}

// Footer label for a note with no web source (typed note / uploaded image or PDF / Clip AI).
function savedLabel(note: Note): string {
  switch (note.input_type) {
    case "image":
      return "Image";
    case "pdf":
      return "PDF";
    case "text":
      return "Note";
    case "voice":
      return "Voice";
    case "video":
      return "Video";
    default:
      return note.source === "ai" ? "Clip AI" : "Saved";
  }
}

// Two-tap delete; used inside the note view (NoteHeader), not on feed cards.
export function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <button
      type="button"
      aria-label={confirm ? "Confirm delete" : "Delete note"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm) {
          setConfirm(true);
          setTimeout(() => setConfirm(false), 2500);
          return;
        }
        onDelete();
      }}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full border text-sm transition-colors ${
        confirm
          ? "border-destructive bg-destructive px-3 text-white"
          : "w-9 border-border bg-card text-ink-soft hover:text-destructive"
      }`}
    >
      <Trash2 className="h-4 w-4" />
      {confirm && "Sure?"}
    </button>
  );
}

// Cover image with a built-in fallback: the type-accented icon placeholder sits behind
// the image, so a missing OR broken cover reveals an intentional visual rather than a
// blank box. Every card gets *something* — a feed of dead tiles invites no return.
export function CoverThumb({
  note,
  className = "",
  onImageError,
}: {
  note: Note;
  className?: string;
  onImageError?: () => void;
}) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  return (
    <div className={`relative overflow-hidden ${accent.soft} ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon className={`h-1/3 max-h-10 w-1/3 max-w-10 opacity-70 ${accent.text}`} />
      </div>
      {note.cover_image_url && (
        <img
          src={note.cover_image_url}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none"; // reveal the placeholder behind it
            onImageError?.(); // let the card drop the now-redundant label icon
          }}
        />
      )}
    </div>
  );
}

// A note "has a cover" only if a URL exists AND it actually loaded. Cards render the
// thumbnail solely on this signal, so a missing or broken cover shows no tile at all —
// the type icon beside the label carries the visual instead.
function useCoverPresent(note: Note) {
  const [broken, setBroken] = useState(false);
  return {
    hasCover: Boolean(note.cover_image_url) && !broken,
    onImageError: () => setBroken(true),
  };
}

// Uniform card: no cover preview — every note gets the same anatomy (icon chip + date,
// title, summary, source footer). The card hugs its content (no min-heights), so a short
// title doesn't bake in dead space; the summary clamp adapts to the title's line count to
// keep total height balanced — a 2-line title gets a 2-line preview, a 1-line title gets 3.
export function NoteCard({ note }: { note: Note }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const { hasCover, onImageError } = useCoverPresent(note);
  const price = typeof note.data?.price === "string" ? (note.data.price as string) : null;

  // Measure how many lines the (already 2-line-clamped) title actually renders to. Title
  // wrapping changes with card width — which shifts across the responsive 1–4 col grid —
  // so re-measure on (shared, debounced) window resize; a layout toggle remounts the card
  // and re-measures on mount.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleLines, setTitleLines] = useState(1);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const measure = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (lh > 0) setTitleLines(Math.max(1, Math.round(el.offsetHeight / lh)));
    };
    measure();
    return onSharedResize(measure);
  }, [note.title]);
  const summaryClamp = titleLines >= 2 ? "line-clamp-2" : "line-clamp-3";

  return (
    <WithNoteMenu note={note}>
      <Link
        to="/notes/$noteId"
        params={{ noteId: note.id }}
        className={`group relative flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 ring-2 ring-transparent transition-all [-webkit-touch-callout:none] select-none hover:-translate-y-0.5 hover:shadow-lg ${FOCUS_RING} ${accent.ring}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {/* The type icon always rides with the label; the cover thumbnail only appears
              when the note actually has a (working) cover image — no placeholder tiles. */}
            {hasCover && (
              <CoverThumb
                note={note}
                className="h-12 w-12 shrink-0 rounded-xl"
                onImageError={onImageError}
              />
            )}
            <span
              className={`inline-flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${accent.chip}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{noteLabel(note.content_type)}</span>
            </span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-soft">
            {formatDateShort(note.created_at)}
          </span>
        </div>

        <h3
          ref={titleRef}
          className="mt-4 font-serif text-2xl leading-[1.15] text-ink line-clamp-2"
        >
          {note.title}
        </h3>
        <p className={`mt-2 text-sm leading-relaxed text-ink-soft ${summaryClamp}`}>
          {note.ai_summary}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-ink-soft">
          {note.source_domain ? (
            <>
              <img
                loading="lazy"
                src={`https://www.google.com/s2/favicons?domain=${note.source_domain}&sz=32`}
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
                alt=""
                className="h-3.5 w-3.5 rounded-sm"
              />
              <span className="truncate capitalize">{sourceLabel(note.source_domain)}</span>
            </>
          ) : (
            // Typed-note / uploaded capture: no web source — label by how it was saved.
            <span className="truncate capitalize">{savedLabel(note)}</span>
          )}
          {price && <span className="ml-auto font-serif text-sm text-ink">{price}</span>}
        </div>
      </Link>
    </WithNoteMenu>
  );
}

// --- Board (masonry) card -------------------------------------------------------
// The image-forward tile for the Pinterest-style "Board" feed view. Unlike NoteCard (a
// uniform text card with no cover preview), this celebrates the cover: it fills the top at
// its natural aspect, so tall images stay tall and the masonry reads organic. A coverless
// note falls back to an accent-tinted gradient with its title set large in the app's serif
// display face — a tile designed to hold its own between real photos, not read as a miss.
// It only ever renders finished notes — the feed keeps rendering in-flight/failed captures
// as standard cards.

// Stable seed for per-note variety (placeholder aspect) without a stored field.
function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Coverless placeholders vary in height so the masonry doesn't render a wall of identical tiles.
const PLACEHOLDER_ASPECTS = ["aspect-square", "aspect-[4/5]", "aspect-[3/4]"];

// Board covers keep their natural shape only within this band; extremes get cropped by
// object-cover. Keeps the masonry lively but rhythmic: a 9:16 reel can't swallow a column
// and a wide og-image banner can't collapse into a sliver.
const BOARD_RATIO_MIN = 3 / 4; // tallest tile (portrait)
const BOARD_RATIO_MAX = 3 / 2; // shortest tile (landscape)

// `ratio` pins the cover (and coverless placeholder) to a fixed aspect instead of the
// natural-shape masonry band — the Shelves view passes 4/5 (portrait) so every tile in a
// horizontal row lands the same height and the row scrolls as one clean strip.
// `hideCategory` drops the category name from the footer — Shelves already groups by
// category, so repeating it under every tile read as noise.
export function BoardCard({
  note,
  ratio,
  hideCategory = false,
}: {
  note: Note;
  ratio?: number;
  hideCategory?: boolean;
}) {
  const accent = noteAccent(note.content_type);
  const TypeIcon = noteIcon(note.content_type);
  const { hasCover, onImageError } = useCoverPresent(note);
  // Natural cover ratio, measured on load; null until then (pre-load tiles use the band's
  // portrait end, since video thumbnails dominate saved content).
  const [coverRatio, setCoverRatio] = useState<number | null>(null);
  // Drives the image's fade-in — covers pop in as they finish loading instead of snapping in,
  // which reads calmer on a fast-scrolling feed. Placeholders (no network image) skip this.
  const [coverLoaded, setCoverLoaded] = useState(false);
  // Sub-line: a quiet accent dot (the same color-coding as the category chip elsewhere,
  // without the loud pill background), with the source favicon + short date on the right.
  const date = formatDateShort(note.created_at);
  const placeholderAspect = PLACEHOLDER_ASPECTS[seedFromId(note.id) % PLACEHOLDER_ASPECTS.length];
  // The accent's underlying token name ("recipe" from "bg-recipe"), so the placeholder can
  // build a `var(--{token}-soft)` gradient. Tailwind can't discover a dynamically-assembled
  // utility class like `from-${token}-soft` at build time, but a raw CSS custom-property
  // reference works at runtime and still tracks light/dark mode automatically — both are
  // defined on :root and .dark for every accent.
  const accentToken = accent.dot.replace(/^bg-/, "");
  // Placeholder text sits on the `-soft` gradient, not the `-chip` pill background, but the
  // WCAG-audited pairing for `-soft` is the `-chip` foreground (see PALETTES above) — reuse
  // the chip's text-* class rather than accent.text (contrast-audited for the plain card bg).
  const placeholderTextClass =
    accent.chip.split(" ").find((cls) => cls.startsWith("text-")) ?? accent.text;
  // Cached/back-forward-cache images never fire `onLoad` (and Safari's lazy-load can skip it
  // too), which would leave the tile permanently at opacity-0. A callback ref checks the
  // already-loaded state synchronously on mount so those covers still show up.
  const coverRef = useCallback((el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth > 0) {
      setCoverRatio(el.naturalWidth / el.naturalHeight);
      setCoverLoaded(true);
    }
  }, []);

  return (
    <WithNoteMenu note={note}>
      <Link
        to="/notes/$noteId"
        params={{ noteId: note.id }}
        className={`group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card ring-2 ring-transparent transition-all duration-200 ease-out [-webkit-touch-callout:none] select-none md:hover:-translate-y-1 md:hover:shadow-xl ${FOCUS_RING} ${accent.ring}`}
      >
        <div className="relative">
          {hasCover ? (
            <img
              ref={coverRef}
              src={note.cover_image_url!}
              alt=""
              loading="lazy"
              onError={onImageError}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth && el.naturalHeight)
                  setCoverRatio(el.naturalWidth / el.naturalHeight);
                setCoverLoaded(true);
              }}
              className={`w-full object-cover transition-[transform,opacity] duration-300 ease-out md:group-hover:scale-[1.03] ${
                coverLoaded ? "opacity-100" : "opacity-0"
              }`}
              style={{
                aspectRatio:
                  ratio ??
                  Math.min(
                    BOARD_RATIO_MAX,
                    Math.max(BOARD_RATIO_MIN, coverRatio ?? BOARD_RATIO_MIN),
                  ),
              }}
            />
          ) : (
            // Coverless tile: a soft gradient in the note's own accent color (top) settling
            // into the card surface (bottom), with the title set large in the serif display
            // face and a faint oversized type-icon watermark — designed to sit between real
            // photos, not read as an empty box.
            <div
              className={`relative flex ${ratio ? "" : placeholderAspect} flex-col justify-between overflow-hidden p-5`}
              style={{
                backgroundImage: `linear-gradient(155deg, var(--${accentToken}-soft), var(--card))`,
                ...(ratio ? { aspectRatio: ratio } : {}),
              }}
            >
              <TypeIcon
                aria-hidden
                className={`h-5 w-5 shrink-0 opacity-50 ${placeholderTextClass}`}
              />
              <TypeIcon
                aria-hidden
                className={`pointer-events-none absolute -bottom-8 -right-8 h-32 w-32 opacity-[0.07] ${accent.text}`}
              />
              {/* The fixed shelf tile has less vertical room than the tallest masonry
                  placeholders, so the title clamps tighter there to stay inside the tile. */}
              <span
                className={`relative break-words font-serif text-2xl leading-[1.15] [overflow-wrap:anywhere] ${
                  ratio ? "line-clamp-4" : "line-clamp-5"
                } ${placeholderTextClass}`}
              >
                {note.title}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col px-3.5 pb-3.5 pt-3">
          {/* The only loud element on the tile — everything else below is deliberately quiet.
              Fixed-ratio (shelf) tiles reserve two lines for the title so every card in the
              row lands the same total height, whatever the title's actual length. */}
          <h3
            className={`text-[15px] font-semibold leading-snug tracking-tight text-ink line-clamp-2 ${
              ratio ? "min-h-[2.75em]" : ""
            }`}
          >
            {note.title}
          </h3>
          <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-soft/80">
            {hideCategory ? (
              // Shelf tiles: the shelf header already names the category, so the left slot
              // carries the source instead — favicon + name (a failed favicon just hides
              // itself and the name still reads).
              note.source_domain && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <img
                    loading="lazy"
                    src={`https://www.google.com/s2/favicons?domain=${note.source_domain}&sz=32`}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                    alt=""
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 rounded-sm"
                  />
                  <span className="truncate capitalize">{sourceLabel(note.source_domain)}</span>
                </span>
              )
            ) : (
              <>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} aria-hidden />
                <span className="truncate">{noteLabel(note.content_type)}</span>
              </>
            )}
            {/* Date anchors the bottom-right; the board (category-labelled) tile keeps its
                source favicon riding just left of the date. */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {!hideCategory && note.source_domain && (
                <img
                  loading="lazy"
                  src={`https://www.google.com/s2/favicons?domain=${note.source_domain}&sz=32`}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                  alt={sourceLabel(note.source_domain)}
                  title={sourceLabel(note.source_domain)}
                  className="h-3.5 w-3.5 rounded-sm"
                />
              )}
              {date && <span className="whitespace-nowrap">{date}</span>}
            </span>
          </p>
        </div>
      </Link>
    </WithNoteMenu>
  );
}

// Condensed layout: a contained "ledger" — one bordered card holding hairline-divided
// rows (see NoteRowList). Serif titles keep it in the app's editorial voice; min-w-0 +
// truncate are load-bearing: flex children default to min-width:auto, which lets long
// titles stretch rows past the viewport on phones.
export function NoteRow({ note }: { note: Note }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const { hasCover, onImageError } = useCoverPresent(note);
  return (
    <WithNoteMenu note={note}>
      <Link
        to="/notes/$noteId"
        params={{ noteId: note.id }}
        className={`group flex w-full min-w-0 items-center gap-3.5 border-b border-border px-4 py-3 transition-colors [-webkit-touch-callout:none] select-none hover:bg-accent ${FOCUS_RING}`}
      >
        {hasCover && (
          <CoverThumb
            note={note}
            className="h-14 w-14 shrink-0 self-start rounded-lg border border-border/60"
            onImageError={onImageError}
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${accent.chip}`}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {noteLabel(note.content_type)}
            </span>
          </div>
          <h3 className="mt-1.5 text-[15px] font-medium leading-snug text-ink line-clamp-2">
            {note.title}
          </h3>
        </div>

        <span className="shrink-0 self-start text-[11px] tabular-nums text-ink-soft">
          {formatDateShort(note.created_at)}
        </span>
      </Link>
    </WithNoteMenu>
  );
}

// The condensed view's container: constrained width (never stretches on wide screens),
// rows divided by hairlines instead of per-row borders. Processing rows (if any) sit on top.
export function NoteRowList({
  notes,
  jobs = [],
  queuedJobs = [],
  deferredJobs = [],
  failedJobs = [],
  onRetry,
  onDismiss,
}: {
  notes: Note[];
  jobs?: Job[];
  queuedJobs?: Job[];
  deferredJobs?: Job[];
  failedJobs?: Job[];
  onRetry?: (job: Job) => void;
  onDismiss?: (jobId: string) => void;
}) {
  // Each row paints its own border-b (dividers can't live on the container's direct
  // children: note rows sit inside a display:contents menu wrapper, which computes but
  // never paints borders). The container only exempts the bottom row(s) so the hairline
  // never doubles the container border — both the wrapped (`>*>*`) and unwrapped (`>*`)
  // child shapes are covered; the extra selector is a no-op on the other shape.
  return (
    <section className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border bg-card lg:max-w-6xl">
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-6 [&>*:last-child]:border-b-0 [&>*:last-child>*]:border-b-0 lg:[&>*:nth-last-child(-n+2)]:border-b-0 lg:[&>*:nth-last-child(-n+2)>*]:border-b-0">
        {failedJobs.map((j) => (
          <FailedRow
            key={j.id}
            job={j}
            onRetry={onRetry ?? (() => {})}
            onDismiss={onDismiss ?? (() => {})}
          />
        ))}
        {deferredJobs.map((j) => (
          <ProcessingRow key={j.id} job={j} label="Queued, high demand" />
        ))}
        {queuedJobs.map((j) => (
          <ProcessingRow key={j.id} job={j} label="Waiting for connection" />
        ))}
        {jobs.map((j) => (
          <ProcessingRow key={j.id} job={j} />
        ))}
        {notes.map((n) => (
          <NoteRow key={n.id} note={n} />
        ))}
      </div>
    </section>
  );
}

// --- Optimistic "processing" placeholders, driven by the jobs collection ---
// A freshly-ingested URL has a jobs/{id} doc within ~50ms but no note for 12–70s. These
// stand in for that gap so the capture reads as "received & working", not "did nothing".

function jobDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

// Pick the status glyph from the label: a spinner while actively processing, a wifi-off
// for offline-held captures, and a clock for anything else parked (e.g. "Queued — high demand").
function StatusIcon({ label, className }: { label: string; className: string }) {
  if (label === "Processing") return <Loader2 className={`${className} animate-spin`} />;
  if (label.toLowerCase().includes("connection")) return <WifiOff className={className} />;
  return <Clock className={className} />;
}

export function ProcessingCard({ job, label = "Processing" }: { job: Job; label?: string }) {
  const domain = jobDomain(job.url);
  const waiting = label !== "Processing"; // parked (queued/offline) → skeleton, not the save motion
  return (
    <div
      className="relative flex min-w-0 flex-col rounded-2xl border border-dashed border-border bg-card p-4"
      aria-label={waiting ? `Capture ${label.toLowerCase()}` : "Note processing"}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-soft">
          <StatusIcon label={label} className="h-3 w-3" />
          {waiting ? label : "Saving"}
        </span>
        <span className="text-[11px] text-ink-soft">just now</span>
      </div>

      {waiting ? (
        <div className="animate-pulse">
          <div className="mt-3 min-h-[2.5em] space-y-2">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
          </div>
          <div className="mt-2 min-h-[4.3em] space-y-2">
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-5/6 rounded bg-muted" />
          </div>
        </div>
      ) : (
        // A freshly-captured note: the clip snaps onto a note card while Gemini works.
        <div className="flex min-h-[6.8em] flex-1 flex-col items-center justify-center py-2">
          <SaveSnap />
          <p className="mt-3 text-sm text-ink-soft">Saving your note…</p>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-ink-soft">
        <img
          loading="lazy"
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
          alt=""
          className="h-3.5 w-3.5 rounded-sm"
        />
        <span className="truncate capitalize">{sourceLabel(domain)}</span>
      </div>
    </div>
  );
}

// A capture that failed must say so — a vanishing processing card reads as data loss.
export function FailedCard({
  job,
  onRetry,
  onDismiss,
}: {
  job: Job;
  onRetry: (job: Job) => void;
  onDismiss: (jobId: string) => void;
}) {
  const domain = jobDomain(job.url);
  return (
    <div
      className="relative flex min-w-0 flex-col rounded-2xl border border-destructive/30 bg-destructive/5 p-4"
      aria-label="Capture failed"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
          <AlertCircle className="h-3 w-3" />
          Couldn't save
        </span>
        <button
          type="button"
          onClick={() => onDismiss(job.id)}
          aria-label="Dismiss"
          className="text-ink-soft transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-3 break-all text-sm font-medium text-ink line-clamp-2">{job.url}</p>
      <p className="mt-1.5 text-xs text-ink-soft line-clamp-2">
        {JOB_ERRORS[job.error ?? ""] ?? (job.error || "Something went wrong while processing this link.")}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="truncate capitalize text-[11px] text-ink-soft">{sourceLabel(domain)}</span>
        <button
          type="button"
          onClick={() => onRetry(job)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-accent"
        >
          <RotateCcw className="h-3 w-3" />
          Try again
        </button>
      </div>
    </div>
  );
}

export function FailedRow({
  job,
  onRetry,
  onDismiss,
}: {
  job: Job;
  onRetry: (job: Job) => void;
  onDismiss: (jobId: string) => void;
}) {
  const domain = jobDomain(job.url);
  return (
    <div
      className="flex w-full min-w-0 items-center gap-3.5 border-b border-border px-4 py-3"
      aria-label="Capture failed"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-lg bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-all text-sm font-medium text-ink line-clamp-1">{job.url}</p>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
          <span className="font-medium text-destructive">Couldn't save</span>
          <span>·</span>
          <span className="truncate capitalize">{sourceLabel(domain)}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRetry(job)}
        aria-label="Try again"
        className="shrink-0 rounded-full border border-border bg-card p-2 text-ink-soft transition-colors hover:text-ink"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onDismiss(job.id)}
        aria-label="Dismiss"
        className="shrink-0 text-ink-soft transition-colors hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ProcessingRow({ job, label = "Processing" }: { job: Job; label?: string }) {
  const domain = jobDomain(job.url);
  const waiting = label !== "Processing";
  return (
    <div
      className="flex w-full min-w-0 items-center gap-3.5 border-b border-border px-4 py-3"
      aria-label={waiting ? `Capture ${label.toLowerCase()}` : "Note processing"}
    >
      {waiting ? (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-lg bg-muted text-ink-soft">
          <StatusIcon label={label} className="h-5 w-5" />
        </span>
      ) : (
        // The clip snaps onto a note while this fresh capture processes.
        <span className="flex h-12 w-12 shrink-0 items-center justify-center self-start overflow-hidden rounded-lg bg-muted">
          <SaveSnap scale={0.42} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className={`h-4 w-2/3 rounded bg-muted ${waiting ? "animate-pulse" : ""}`} />
        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
          <span className="font-medium">{waiting ? label : "Saving"}</span>
          <span>·</span>
          <span className="truncate capitalize">{sourceLabel(domain)}</span>
        </div>
      </div>
    </div>
  );
}
