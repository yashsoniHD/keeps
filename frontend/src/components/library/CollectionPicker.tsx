import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, FolderPlus, Loader2, Plus, X } from "lucide-react";
import type { Collection, Note } from "@/lib/types";
import { createCollection } from "@/lib/firestore";
import { moveNoteToCollection } from "@/lib/api";
import { iconByName, paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";

// "Move to collection" sheet — shared by the feed card menu and the note detail header.
// Membership is single-home (a note lives in at most one collection) and backend-written, so
// picking a bucket PATCHes the note's collection_id; local state reflects the choice instantly.
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
  const [currentCid, setCurrentCid] = useState<string | null>(note.collection_id ?? null);

  const isIn = (c: Collection) => currentCid === c.id;

  const toggle = async (c: Collection) => {
    // Single-home: picking the current bucket clears it (→ Notes catch-all); else move it here.
    const next = isIn(c) ? null : c.id;
    setCurrentCid(next);
    try {
      await moveNoteToCollection(note.id, next);
    } catch {
      setCurrentCid(note.collection_id ?? null); // revert on failure
    }
  };

  const create = async () => {
    const n = name.trim();
    if (!n || !uid || busy) return;
    setBusy(true);
    try {
      const cid = await createCollection(uid, n, { description: n });
      await moveNoteToCollection(note.id, cid);
      setCurrentCid(cid);
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
          <h2 className="font-serif text-xl text-ink">Move to collection</h2>
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
                className={`-my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground active:scale-95 ${FOCUS_RING}`}
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
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      checked ? "border-brand bg-brand text-brand-foreground" : "border-border"
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
