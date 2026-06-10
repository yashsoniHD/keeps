import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import type { Note } from "@/lib/types";
import { formatDate, noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";

function DeleteButton({
  onDelete,
  className = "",
}: {
  onDelete: () => void;
  className?: string;
}) {
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
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-full text-xs shadow-sm backdrop-blur transition-colors ${
        confirm
          ? "w-auto bg-destructive px-2.5 text-white"
          : "w-8 bg-card/90 text-ink-soft hover:text-destructive"
      } ${className}`}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {confirm && "Sure?"}
    </button>
  );
}

export function NoteCard({ note, onDelete }: { note: Note; onDelete?: () => void }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const price = typeof note.data?.price === "string" ? (note.data.price as string) : null;

  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card ring-2 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg ${accent.ring}`}
    >
      {onDelete && (
        <div className="absolute right-3 top-3 z-10 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <DeleteButton onDelete={onDelete} />
        </div>
      )}

      {note.cover_image_url ? (
        <div className="relative h-40 overflow-hidden">
          <img
            src={note.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
            }}
          />
          {price && (
            <span className="absolute left-3 top-3 rounded-full bg-card px-2.5 py-0.5 font-serif text-sm text-ink shadow-sm">
              {price}
            </span>
          )}
        </div>
      ) : (
        <div className={`paper-grain p-4 ${accent.soft}`}>
          <div className={`flex items-center gap-1.5 text-xs uppercase tracking-wider ${accent.text}`}>
            <Icon className="h-3 w-3" />
            {noteLabel(note.content_type)}
          </div>
          <p className="mt-2 font-serif text-base leading-snug text-ink line-clamp-3">
            {note.ai_summary}
          </p>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${accent.chip}`}
          >
            <Icon className="h-3 w-3" />
            {noteLabel(note.content_type)}
          </span>
          <span className="text-[11px] text-ink-soft">{formatDate(note.created_at)}</span>
        </div>

        <h3 className="font-serif text-xl leading-tight text-ink line-clamp-2">{note.title}</h3>
        <p className="text-sm text-ink-soft line-clamp-3">{note.ai_summary}</p>

        <div className="mt-auto flex items-center gap-2 pt-1 text-[11px] text-ink-soft">
          <img
            src={`https://www.google.com/s2/favicons?domain=${note.source_domain}&sz=32`}
            alt=""
            className="h-3.5 w-3.5 rounded-sm"
          />
          <span>{note.source_domain}</span>
        </div>
      </div>
    </Link>
  );
}

// Condensed layout: one slim row per note — scan many notes at once.
export function NoteRow({ note, onDelete }: { note: Note; onDelete?: () => void }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);

  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent"
    >
      {note.cover_image_url ? (
        <img
          src={note.cover_image_url}
          alt=""
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent.chip}`}>
          <Icon className="h-4 w-4" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{note.title}</div>
        <div className="flex items-center gap-2 text-[11px] text-ink-soft">
          <span className={`${accent.text}`}>{noteLabel(note.content_type)}</span>
          <span>·</span>
          <span className="truncate">{note.source_domain}</span>
        </div>
      </div>

      <span className="hidden shrink-0 text-[11px] text-ink-soft sm:block">
        {formatDate(note.created_at)}
      </span>
      {onDelete && (
        <div className="shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100">
          <DeleteButton onDelete={onDelete} />
        </div>
      )}
    </Link>
  );
}
