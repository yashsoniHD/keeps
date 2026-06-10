import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { Note } from "@/lib/types";
import { formatDate } from "@/lib/note-meta";
import { TypeBadge } from "./TypeBadge";
import { SourcePill } from "./SourcePill";

export function NoteHeader({ note }: { note: Note }) {
  return (
    <header className="mb-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Notes
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={note.content_type} size="md" />
        <SourcePill domain={note.source_domain} url={note.source_url} />
        <span className="text-xs text-ink-soft">{formatDate(note.created_at)}</span>
      </div>

      <h1 className="font-serif text-4xl leading-[1.05] text-ink md:text-6xl">{note.title}</h1>
    </header>
  );
}
