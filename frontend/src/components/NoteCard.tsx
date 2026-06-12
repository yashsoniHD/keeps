import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trash2, Loader2, AlertCircle, RotateCcw, WifiOff, X } from "lucide-react";
import type { Note, Job } from "@/lib/types";
import {
  formatDate,
  formatDateShort,
  noteAccent,
  noteIcon,
  noteLabel,
  sourceLabel,
} from "@/lib/note-meta";

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

// Uniform card: no cover preview — every note gets the same anatomy (chip + date,
// title, summary, source footer). min-heights on title/summary reserve their full
// line-clamp space so cards stay equal-sized even when text runs short.
export function NoteCard({ note }: { note: Note }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const price = typeof note.data?.price === "string" ? (note.data.price as string) : null;

  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className={`group relative flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4 ring-2 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg ${accent.ring}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${accent.chip}`}
        >
          <Icon className="h-3 w-3" />
          {noteLabel(note.content_type)}
        </span>
        <span className="text-[11px] text-ink-soft">{formatDate(note.created_at)}</span>
      </div>

      <h3 className="mt-3 min-h-[2.5em] font-serif text-xl leading-tight text-ink line-clamp-2">
        {note.title}
      </h3>
      <p className="mt-2 min-h-[4.3em] text-sm text-ink-soft line-clamp-3">{note.ai_summary}</p>

      <div className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-ink-soft">
        <img
          src={`https://www.google.com/s2/favicons?domain=${note.source_domain}&sz=32`}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
          alt=""
          className="h-3.5 w-3.5 rounded-sm"
        />
        <span className="truncate">{sourceLabel(note.source_domain)}</span>
        {price && <span className="ml-auto font-serif text-sm text-ink">{price}</span>}
      </div>
    </Link>
  );
}

// Condensed layout: a contained "ledger" — one bordered card holding hairline-divided
// rows (see NoteRowList). Serif titles keep it in the app's editorial voice; min-w-0 +
// truncate are load-bearing: flex children default to min-width:auto, which lets long
// titles stretch rows past the viewport on phones.
export function NoteRow({ note }: { note: Note }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);

  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className="group flex w-full min-w-0 items-center gap-3.5 px-4 py-3 transition-colors hover:bg-accent"
    >
      {note.cover_image_url ? (
        <img
          src={note.cover_image_url}
          alt=""
          loading="lazy"
          className="h-12 w-12 shrink-0 self-start rounded-lg border border-border/60 object-cover"
          onError={(e) => {
            // Swap the broken image for the type chip so the row stays aligned.
            const img = e.currentTarget;
            img.style.display = "none";
            (img.nextElementSibling as HTMLElement | null)?.classList.remove("hidden");
          }}
        />
      ) : null}
      <span
        className={`${note.cover_image_url ? "hidden" : ""} flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-lg ${accent.chip}`}
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="font-serif text-base leading-snug text-ink line-clamp-2">{note.title}</h3>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
          <span className={`shrink-0 font-medium ${accent.text}`}>
            {noteLabel(note.content_type)}
          </span>
          <span className="shrink-0">·</span>
          <span className="truncate">{sourceLabel(note.source_domain)}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatDateShort(note.created_at)}</span>
        </div>
      </div>
    </Link>
  );
}

// The condensed view's container: constrained width (never stretches on wide screens),
// rows divided by hairlines instead of per-row borders. Processing rows (if any) sit on top.
export function NoteRowList({
  notes,
  jobs = [],
  queuedJobs = [],
  failedJobs = [],
  onRetry,
  onDismiss,
}: {
  notes: Note[];
  jobs?: Job[];
  queuedJobs?: Job[];
  failedJobs?: Job[];
  onRetry?: (job: Job) => void;
  onDismiss?: (jobId: string) => void;
}) {
  // Desktop (lg+) packs rows into 2 columns. `divide-y` can't draw the dividers there
  // (it's a sibling selector, blind to grid geometry), so each child gets its own
  // border-b instead — minus the bottom row, which would double the container border.
  return (
    <section className="mx-auto max-w-3xl overflow-hidden rounded-3xl border border-border bg-card lg:max-w-6xl">
      <div className="divide-y divide-border/70 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:divide-y-0 lg:[&>*]:border-b lg:[&>*]:border-border/70 lg:[&>*:nth-last-child(-n+2)]:border-b-0">
        {failedJobs.map((j) => (
          <FailedRow
            key={j.id}
            job={j}
            onRetry={onRetry ?? (() => {})}
            onDismiss={onDismiss ?? (() => {})}
          />
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

export function ProcessingCard({ job, label = "Processing" }: { job: Job; label?: string }) {
  const domain = jobDomain(job.url);
  const waiting = label !== "Processing"; // offline-queued: held locally, not spinning
  return (
    <div
      className="relative flex min-w-0 animate-pulse flex-col rounded-2xl border border-dashed border-border bg-card p-4"
      aria-label={waiting ? "Capture waiting for connection" : "Note processing"}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink-soft">
          {waiting ? <WifiOff className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
          {label}
        </span>
        <span className="text-[11px] text-ink-soft">just now</span>
      </div>

      <div className="mt-3 min-h-[2.5em] space-y-2">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
      </div>
      <div className="mt-2 min-h-[4.3em] space-y-2">
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-5/6 rounded bg-muted" />
      </div>

      <div className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-ink-soft">
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
          alt=""
          className="h-3.5 w-3.5 rounded-sm"
        />
        <span className="truncate">{sourceLabel(domain)}</span>
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
        {job.error || "Something went wrong while processing this link."}
      </p>

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <span className="truncate text-[11px] text-ink-soft">{sourceLabel(domain)}</span>
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
    <div className="flex w-full min-w-0 items-center gap-3.5 px-4 py-3" aria-label="Capture failed">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-lg bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-all text-sm font-medium text-ink line-clamp-1">{job.url}</p>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft">
          <span className="font-medium text-destructive">Couldn't save</span>
          <span>·</span>
          <span className="truncate">{sourceLabel(domain)}</span>
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
      className="flex w-full min-w-0 animate-pulse items-center gap-3.5 px-4 py-3"
      aria-label={waiting ? "Capture waiting for connection" : "Note processing"}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-lg bg-muted text-ink-soft">
        {waiting ? <WifiOff className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-soft">
          <span className="font-medium">{label}</span>
          <span>·</span>
          <span className="truncate">{sourceLabel(domain)}</span>
        </div>
      </div>
    </div>
  );
}
