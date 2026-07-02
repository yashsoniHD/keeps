import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Timestamp } from "firebase/firestore";
import { ArrowLeft, FolderPlus, Pencil, Pin, Star } from "lucide-react";
import type { Collection, Note } from "@/lib/types";
import { formatDate } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { updateNote } from "@/lib/api";
import { CategoryEditor } from "./CategoryEditor";
import { SourcePill } from "./SourcePill";
import { ShareButton } from "./ShareButton";
import { DeleteButton } from "@/components/NoteCard";
import { CollectionPicker } from "@/components/library/CollectionPicker";

// Round 36px action button matching DeleteButton's resting style, with an active (on) state.
const HEADER_BTN =
  "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card transition-colors";

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

export function NoteHeader({
  note,
  collections = [],
  uid = null,
  onDelete,
  onPatch,
}: {
  note: Note;
  collections?: Collection[];
  uid?: string | null;
  onDelete?: () => void;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  const [picker, setPicker] = useState(false);

  // Favorite / pin write through the backend (notes are server-write-only); onPatch updates
  // the local note optimistically and reverts on failure so the toggle feels instant.
  const toggleFavorite = async () => {
    const next = !note.is_favorite;
    onPatch?.({ is_favorite: next });
    try {
      await updateNote(note.id, { is_favorite: next });
    } catch {
      onPatch?.({ is_favorite: !next });
    }
  };
  const togglePin = async () => {
    const next = !note.pinned_at;
    const prev = note.pinned_at ?? null;
    onPatch?.({ pinned_at: next ? Timestamp.now() : null }); // backend stamps the real time
    try {
      await updateNote(note.id, { pinned: next });
    } catch {
      onPatch?.({ pinned_at: prev });
    }
  };

  // Single-home membership drives the folder button's "on" look (in a bucket or not).
  const inCollections =
    note.collection_id && collections.some((c) => c.id === note.collection_id) ? 1 : 0;

  return (
    <header className="mb-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link
          to="/notes"
          className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Notes
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleFavorite}
            aria-label={note.is_favorite ? "Remove favorite" : "Favorite"}
            title={note.is_favorite ? "Favorited" : "Favorite"}
            className={`${HEADER_BTN} ${FOCUS_RING} ${
              note.is_favorite ? "text-amber-500" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Star className={`h-4 w-4 ${note.is_favorite ? "fill-amber-400" : ""}`} />
          </button>
          <button
            type="button"
            onClick={togglePin}
            aria-label={note.pinned_at ? "Unpin" : "Pin to top"}
            title={note.pinned_at ? "Pinned to top" : "Pin to top"}
            className={`${HEADER_BTN} ${FOCUS_RING} ${
              note.pinned_at ? "text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <Pin className={`h-4 w-4 ${note.pinned_at ? "fill-ink" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setPicker(true)}
            aria-label="Add to collection"
            title="Add to collection"
            className={`${HEADER_BTN} ${FOCUS_RING} ${
              inCollections > 0 ? "text-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
          <ShareButton note={note} />
          {onDelete && <DeleteButton onDelete={onDelete} />}
        </div>
      </div>
      {picker && (
        <CollectionPicker
          note={note}
          collections={collections}
          uid={uid}
          onClose={() => setPicker(false)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <CategoryEditor type={note.content_type} noteId={note.id} onPatch={onPatch} />
        <SourcePill domain={note.source_domain} url={note.source_url} />
        <span className="text-xs text-ink-soft">{formatDate(note.created_at)}</span>
      </div>

      <EditableTitle note={note} onPatch={onPatch} />
    </header>
  );
}
