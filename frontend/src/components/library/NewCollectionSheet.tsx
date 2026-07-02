import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, FolderPlus, Loader2, Sparkles, X } from "lucide-react";
import { createCollection } from "@/lib/firestore";
import { backfillCollection } from "@/lib/api";
import {
  CATEGORY_ICONS,
  PALETTE_DOTS,
  defaultPaletteFor,
  iconByName,
  paletteAccent,
} from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";

// Creation sheet for a smart collection. Unlike the old inline name-only input, this collects
// a real description (it steers BOTH the backfill embedding and the ingest classifier — the
// difference between an empty "AI" bucket and a working one) and an icon + colour, then awaits
// the backfill and reports what it swept in, so creating a collection never *looks* broken.
export function NewCollectionSheet({ uid, onClose }: { uid: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [palette, setPalette] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After creation: the new collection's id + how many existing notes the sweep filed into it.
  const [created, setCreated] = useState<{ id: string; assigned: number } | null>(null);

  // Live identity: an explicit pick wins; otherwise the name hashes to a stable colour so the
  // preview (and the resulting home tile) is never gray.
  const effectivePalette = palette ?? defaultPaletteFor(name || "collection");
  const accent = paletteAccent(effectivePalette);
  const Icon = iconByName(icon) ?? FolderPlus;

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createCollection(uid, n, {
        description: description.trim() || n,
        icon,
        palette: effectivePalette,
      });
      // Await the sweep so we can say what happened instead of silently hoping.
      let assigned = 0;
      try {
        assigned = (await backfillCollection(id)).assigned;
      } catch {
        // Sweep is best-effort — the collection exists; new saves will still be filed into it.
      }
      setCreated({ id, assigned });
    } catch {
      setError("Couldn't create the collection. Please try again.");
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
        aria-label="New collection"
        className="relative z-[81] max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-2xl text-ink">New collection</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:text-ink ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {created ? (
          // Done: report the sweep honestly, then hand over to the collection page.
          <div className="text-center">
            <span
              className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${accent.dot} text-white shadow-md`}
            >
              <Icon className="h-6 w-6" />
            </span>
            <p className="mt-4 font-serif text-xl text-ink">“{name.trim()}” is ready</p>
            <p className="mt-1.5 text-sm text-ink-soft">
              {created.assigned > 0 ? (
                <>
                  <Check className="mr-1 inline h-3.5 w-3.5 text-success" />
                  Swept {created.assigned} existing {created.assigned === 1 ? "note" : "notes"} in
                  — and new saves that match will land here automatically.
                </>
              ) : (
                "No existing notes matched yet — new saves that fit will land here automatically."
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate({ to: "/library/$collectionId", params: { collectionId: created.id } });
              }}
              className={`mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper ${FOCUS_RING}`}
            >
              Open collection
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            {/* Name, wearing the live icon + colour so the tile-to-be is visible while typing. */}
            <div className="flex items-center gap-3">
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent.dot} text-white shadow-sm`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name — e.g. AI, Interiors, Gift ideas"
                className="w-full rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink"
              />
            </div>

            {/* The description is what makes a collection smart — say so. */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What goes here? e.g. AI tools, LLM articles, ML research…"
              className="mt-3 w-full resize-none rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none placeholder:text-ink-soft focus:border-ink"
            />
            <p className="mt-1.5 flex items-start gap-1.5 px-1 text-xs text-ink-soft">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-product" />
              Clipnote uses this to sweep in matching notes now and file future saves here.
            </p>

            {/* Icon + colour, same picker vocabulary as Manage categories. */}
            <div className="mt-3 rounded-2xl border border-border bg-paper p-3">
              <div className="grid grid-cols-8 gap-1">
                {Object.entries(CATEGORY_ICONS).map(([iconName, IconOpt]) => (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setIcon(iconName)}
                    aria-label={iconName}
                    aria-pressed={icon === iconName}
                    className={`inline-flex aspect-square items-center justify-center rounded-lg transition-colors ${
                      icon === iconName ? "bg-ink text-paper" : "text-ink-soft hover:bg-accent"
                    }`}
                  >
                    <IconOpt className="h-4 w-4" />
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {PALETTE_DOTS.map((dot, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPalette(i)}
                    aria-label={`Colour ${i + 1}`}
                    aria-pressed={effectivePalette === i}
                    className={`h-7 w-7 rounded-full ${dot} ring-2 ring-offset-2 ring-offset-paper transition-all ${
                      effectivePalette === i ? "ring-ink" : "ring-transparent hover:ring-border"
                    }`}
                  />
                ))}
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <button
              type="button"
              onClick={create}
              disabled={!name.trim() || busy}
              className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition-opacity disabled:opacity-40 ${FOCUS_RING}`}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sweeping in matching notes…
                </>
              ) : (
                "Create collection"
              )}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
