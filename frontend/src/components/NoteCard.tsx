import { Link } from "@tanstack/react-router";
import type { Note } from "@/lib/types";
import { formatDate, noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";

export function NoteCard({ note }: { note: Note }) {
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const price = typeof note.data?.price === "string" ? (note.data.price as string) : null;

  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card ring-2 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg ${accent.ring}`}
    >
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
            <span className="absolute right-3 top-3 rounded-full bg-card px-2.5 py-0.5 font-serif text-sm text-ink shadow-sm">
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
