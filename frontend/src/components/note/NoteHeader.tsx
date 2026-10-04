import { useEffect, useRef, useState } from "react";
import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Pencil, RefreshCw } from "lucide-react";
import type { Note } from "@/lib/types";
import { formatDate } from "@/lib/note-meta";
import { updateNote } from "@/lib/api";
import { CategoryEditor } from "./CategoryEditor";
import { SourcePill } from "./SourcePill";
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
      // Place the caret at the end rather than selecting all — select() triggers the
      // text-selection handles + copy menu on mobile, which the user never wants here.
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
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
        className="title-edit w-full resize-none overflow-hidden bg-transparent font-serif text-3xl leading-[1.05] text-ink outline-none md:text-5xl"
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

// Two-tap re-extract, mirroring DeleteButton's confirm pattern: the first tap arms it, the
// second fires. Re-runs the source through the pipeline to heal a sparse or stale note in place.
// Disabled + spinning from the moment the job starts until it completes or fails, so a repeat
// click can't queue a second job (each one burns a daily ingest-cap slot).
function ReextractButton({
  onReextract,
  running,
}: {
  onReextract: () => void;
  running?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <button
      type="button"
      aria-label={running ? "Re-extracting" : confirm ? "Confirm re-extract" : "Re-extract note"}
      title="Re-extract from the source"
      disabled={running}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (running) return;
        if (!confirm) {
          setConfirm(true);
          timerRef.current = setTimeout(() => setConfirm(false), 2500);
          return;
        }
        clearTimeout(timerRef.current);
        setConfirm(false);
        onReextract();
      }}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full border text-sm transition-colors disabled:opacity-60 ${
        confirm || running
          ? "border-ink bg-ink px-3 text-paper"
          : "w-9 border-border bg-card text-ink-soft hover:text-ink"
      }`}
    >
      <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
      {running ? "Re-extracting" : confirm && "Sure?"}
    </button>
  );
}

// The top action row of the owner note view (Back · Re-extract · Delete). Kept
// separate from the meta/title block so NoteContent can hold it full-width above a side-by-side
// portrait-cover hero while the pills + title move into the hero's right column.
export function NoteActions({
  note,
  onDelete,
  onReextract,
  reextracting,
}: {
  note: Note;
  onDelete?: () => void;
  onReextract?: () => void;
  reextracting?: boolean;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // Back returns to wherever the note was opened from (home feed, search, …). Falls back to
  // home when there's no history — e.g. a shared /notes/{id} link opened cold.
  const goBack = () => {
    if (canGoBack) router.history.back();
    else router.navigate({ to: "/" });
  };

  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <div className="flex items-center gap-2">
        {onReextract && note.source_url && (
          <ReextractButton onReextract={onReextract} running={reextracting} />
        )}
        {onDelete && <DeleteButton onDelete={onDelete} />}
      </div>
    </div>
  );
}

// The pill row (category · source · date) + editable title. Shared between the stacked header
// and the side-by-side portrait hero so the title behaves identically in both layouts.
export function NoteMeta({
  note,
  onPatch,
}: {
  note: Note;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <CategoryEditor type={note.content_type} noteId={note.id} onPatch={onPatch} />
        <SourcePill domain={note.source_domain} url={note.source_url} />
        <span className="text-xs text-ink-soft">{formatDate(note.created_at)}</span>
      </div>
      <EditableTitle note={note} onPatch={onPatch} />
    </div>
  );
}
