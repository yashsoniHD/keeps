import { useEffect, useMemo, useState } from "react";
import { Check, Eraser, Luggage, Plus, Share2, X } from "lucide-react";
import { paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";

const TRIP = paletteAccent(8);

// localStorage key for an itinerary note's packing items — so a half-built list survives a
// reload without any backend write. Note ids are globally unique, so no uid in the key.
const storeKey = (noteId: string) => `note-packing:${noteId}`;

interface PackItem {
  text: string;
  checked: boolean;
}

function load(noteId: string): PackItem[] {
  try {
    const raw = localStorage.getItem(storeKey(noteId));
    return raw ? (JSON.parse(raw) as PackItem[]) : [];
  } catch {
    return [];
  }
}

// A per-trip packing checklist on an itinerary note. Fully client-side: items live in
// localStorage (no backend), so this is the user's own scratch list for what to bring.
// Add, tick off, remove, clear, and share what's still to pack.
export function PackingList({ noteId }: { noteId: string }) {
  const [items, setItems] = useState<PackItem[]>(() => load(noteId));
  const [draft, setDraft] = useState("");

  // Reload when navigating between notes (the component may be reused across detail pages).
  useEffect(() => setItems(load(noteId)), [noteId]);

  const persist = (next: PackItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(storeKey(noteId), JSON.stringify(next));
    } catch {
      /* private mode / quota — the list still works for this session */
    }
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    persist([...items, { text, checked: false }]);
    setDraft("");
  };

  const toggle = (idx: number) =>
    persist(items.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)));

  const remove = (idx: number) => persist(items.filter((_, i) => i !== idx));

  const clearChecked = () => persist(items.filter((it) => !it.checked));

  const remaining = useMemo(() => items.filter((it) => !it.checked).length, [items]);

  const share = async () => {
    const text = items
      .filter((it) => !it.checked)
      .map((it) => `• ${it.text}`)
      .join("\n");
    if (!text) return;
    try {
      if (navigator.share) await navigator.share({ title: "Packing list", text });
      else await navigator.clipboard.writeText(text);
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  };

  return (
    <section className="mt-10 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-serif text-xl text-ink">
          <Luggage className={`h-4 w-4 ${TRIP.text}`} /> Packing list
          {items.length > 0 && (
            <span className="text-sm font-normal text-ink-soft">· {remaining} to pack</span>
          )}
        </h2>
        {items.some((it) => it.checked) && (
          <button
            type="button"
            onClick={clearChecked}
            className={`inline-flex items-center gap-1.5 text-xs text-ink-soft transition-colors hover:text-ink ${FOCUS_RING} rounded`}
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear packed
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-1">
          {items.map((it, idx) => (
            <li key={idx} className="group flex items-center gap-3">
              <button
                type="button"
                onClick={() => toggle(idx)}
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${FOCUS_RING} ${
                  it.checked
                    ? "border-transparent bg-trip text-white"
                    : "border-border bg-background"
                }`}
                aria-pressed={it.checked}
                aria-label={it.checked ? "Mark as not packed" : "Mark as packed"}
              >
                {it.checked && <Check className="h-3.5 w-3.5" />}
              </button>
              <span
                className={`min-w-0 flex-1 text-sm ${it.checked ? "text-ink-soft line-through" : "text-ink"}`}
              >
                {it.text}
              </span>
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Remove item"
                className={`shrink-0 rounded p-1 text-ink-soft/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 ${FOCUS_RING}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add something to pack…"
          className={`min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-ink placeholder:text-ink-soft ${FOCUS_RING}`}
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          aria-label="Add item"
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-trip text-white transition-opacity hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
        >
          <Plus className="h-4 w-4" />
        </button>
        {remaining > 0 && (
          <button
            type="button"
            onClick={share}
            aria-label="Share packing list"
            title="Share packing list"
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
          >
            <Share2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </section>
  );
}
