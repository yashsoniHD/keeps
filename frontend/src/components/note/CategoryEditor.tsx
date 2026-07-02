import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { getUserCategories, slugifyCategory } from "@/lib/firestore";
import { updateNote } from "@/lib/api";
import { noteLabel } from "@/lib/note-meta";
import { TypeBadge } from "./TypeBadge";

// Inline category editor on the note view: tap the badge to open a single search-or-create
// combobox — type to filter your categories, or create a new one in the same field. Writes
// go through updateNote (backend normalises + registers the slug); onPatch reflects it locally.
export function CategoryEditor({
  type,
  noteId,
  onPatch,
}: {
  type: string;
  noteId: string;
  onPatch?: (patch: { content_type: string }) => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    inputRef.current?.focus();
    if (user)
      getUserCategories(user.uid)
        .then(setCategories)
        .catch(() => {});
  }, [open, user]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = async (next: string) => {
    const slug = slugifyCategory(next);
    if (!slug || saving) return;
    setOpen(false);
    if (slug === type) return; // no-op: already this category
    setSaving(true);
    onPatch?.({ content_type: slug }); // optimistic — backend may collapse to an existing slug
    try {
      await updateNote(noteId, { content_type: slug });
    } catch {
      onPatch?.({ content_type: type }); // revert on failure
    } finally {
      setSaving(false);
    }
  };

  // Existing categories (incl. current) filtered by the query.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = Array.from(new Set([type, ...categories]));
    return all.filter(
      (c) => !needle || c.includes(needle) || noteLabel(c).toLowerCase().includes(needle),
    );
  }, [q, categories, type]);

  // Offer "Create" when the typed name isn't already one of the user's categories.
  const newSlug = slugifyCategory(q);
  const canCreate =
    newSlug.length > 0 && !Array.from(new Set([type, ...categories])).includes(newSlug);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-full transition-opacity hover:opacity-80"
        title="Change category"
      >
        <TypeBadge type={type} size="md" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (canCreate) apply(q);
                else if (filtered[0]) apply(filtered[0]);
              }
            }}
            placeholder="Search or create…"
            className="w-full border-b border-border bg-transparent px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-soft"
          />
          <div className="max-h-60 overflow-y-auto p-1.5">
            {filtered.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => apply(c)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-accent"
              >
                {noteLabel(c)}
                {c === type && <Check className="h-3.5 w-3.5 text-ink-soft" />}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onClick={() => apply(q)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink transition-colors hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5 text-ink-soft" />
                Create “{q.trim()}”
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <p className="px-2.5 py-2 text-sm text-ink-soft">No categories</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
