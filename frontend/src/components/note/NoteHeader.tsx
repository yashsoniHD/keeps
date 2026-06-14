import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import type { Note } from "@/lib/types";
import { formatDate } from "@/lib/note-meta";
import { updateNote } from "@/lib/api";
import { CategoryEditor } from "./CategoryEditor";
import { SourcePill } from "./SourcePill";
import { ShareButton } from "./ShareButton";
import { DeleteButton } from "@/components/NoteCard";

// Grow a textarea to fit its content so a long title doesn't scroll inside a fixed box.
function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// Click-to-edit title, mirroring the inline-edit idiom in CategoryEditor: optimistic
// onPatch + revert on failure, Enter/blur commits, Escape cancels. Owner-only — the
// public view renders the title as plain text.
function EditableTitle({
  note,
  onPatch,
}: {
  note: Note;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note.title);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Reflect live updates (e.g. the onSnapshot feed) while not actively editing.
  useEffect(() => {
    if (!editing) setValue(note.title);
  }, [note.title, editing]);

  useEffect(() => {
    if (!editing) return;
    const ta = ref.current;
    if (ta) {
      ta.focus();
      ta.select();
      autosize(ta);
    }
  }, [editing]);

  const commit = async () => {
    const next = value.trim();
    setEditing(false);
    if (!next || next === note.title) {
      setValue(note.title); // empty or unchanged → no-op
      return;
    }
    onPatch?.({ title: next }); // optimistic
    try {
      await updateNote(note.id, { title: next });
    } catch {
      onPatch?.({ title: note.title }); // revert on failure
      setValue(note.title);
    }
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={value}
        rows={1}
        onChange={(e) => {
          setValue(e.target.value);
          autosize(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setValue(note.title);
            setEditing(false);
          }
        }}
        onBlur={commit}
        aria-label="Edit title"
        className="w-full resize-none overflow-hidden bg-transparent font-serif text-3xl leading-[1.05] text-ink outline-none md:text-5xl"
      />
    );
  }

  return (
    <h1
      onClick={() => setEditing(true)}
      title="Rename note"
      className="group/title flex cursor-text items-start gap-2 font-serif text-3xl leading-[1.05] text-ink md:text-5xl"
    >
      <span>{note.title}</span>
      <Pencil className="mt-1.5 h-4 w-4 shrink-0 text-ink-soft opacity-0 transition-opacity group-hover/title:opacity-100 md:mt-3 md:h-5 md:w-5" />
    </h1>
  );
}

export function NoteHeader({
  note,
  onDelete,
  onPatch,
}: {
  note: Note;
  onDelete?: () => void;
  onPatch?: (patch: Partial<Note>) => void;
}) {
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
        <div className="flex items-center gap-2">
          <ShareButton note={note} />
          {onDelete && <DeleteButton onDelete={onDelete} />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CategoryEditor type={note.content_type} noteId={note.id} onPatch={onPatch} />
        <SourcePill domain={note.source_domain} url={note.source_url} />
        <span className="text-xs text-ink-soft">{formatDate(note.created_at)}</span>
      </div>

      <EditableTitle note={note} onPatch={onPatch} />
    </header>
  );
}
