import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, FolderPlus, Loader2, Plus, X } from "lucide-react";
import type { Collection, Note } from "@/lib/types";
import {
  addNoteToCollection,
  createCollection,
  removeNoteFromCollection,
} from "@/lib/firestore";
import { iconByName, paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";

// "Add to collection" sheet — shared by the feed card menu and the note detail header.
// Collections are owner-writable client docs, so toggling membership writes directly; the
// caller passes a LIVE `collections` list (a watchCollections subscription), so the
// checkmarks reflect each toggle without local optimistic state.
export function CollectionPicker({
  note,
  collections,
  uid,
  onClose,
}: {
  note: Note;
  collections: Collection[];
  uid: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const isIn = (c: Collection) => (c.note_ids ?? []).includes(note.id);

  const toggle = async (c: Collection) => {
    // Fire-and-forget; the live collections subscription reconciles the checkmark.
    try {
      if (isIn(c)) await removeNoteFromCollection(c.id, note.id);
      else await addNoteToCollection(c.id, note.id);
    } catch {
      /* leave it; the user can retry */
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n || !uid || busy) return;
    setBusy(true);
    try {
      const cid = await createCollection(uid, n);
      await addNoteToCollection(cid, note.id);
      setName("");
    } catch {
      /* leave it; the user can retry */
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      data-no-refresh
    >
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-label="Add to collection"
        className="relative z-[81] w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-xl text-ink">Add to collection</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Create a new collection inline (named) and drop this note straight into it. */}
        <div className="mb-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-background py-2 pl-3.5 pr-1.5">
            <FolderPlus className="h-4 w-4 shrink-0 text-ink-soft" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
              }}
              placeholder="New collection…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-ink-soft"
            />
            {name.trim() && (
              <button
                type="button"
                onClick={create}
                aria-label="Create collection"
                className={`-my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper active:scale-95 ${FOCUS_RING}`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {collections.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-ink-soft">
              No collections yet — name one above to start.
            </p>
          ) : (
            collections.map((c) => {
              const accent = c.palette != null ? paletteAccent(c.palette) : null;
              const Icon = iconByName(c.icon) ?? FolderPlus;
              const checked = isIn(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-ink/5 ${FOCUS_RING}`}
                >
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      accent ? accent.chip : "bg-ink/5 text-ink-soft"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 truncate text-ink">{c.name}</span>
                  <span className="shrink-0 text-xs text-ink-soft">{(c.note_ids ?? []).length}</span>
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      checked ? "border-ink bg-ink text-paper" : "border-border"
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
