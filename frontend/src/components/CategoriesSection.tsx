import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, Loader2, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import {
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
} from "@/lib/api";
import { noteLabel } from "@/lib/note-meta";

type Category = { slug: string; count: number };

// The taxonomy lives behind a single "Manage categories" button rather than spilling the
// whole list into Settings. Tapping it opens a focused editor sheet where each category
// can be renamed, deleted (notes survive — they move to "Summary"), or added. Every
// mutation re-tags notes server-side (see api.ts), so we re-fetch after each to keep
// counts and the list truthful.
export function CategoriesSection() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    listCategories()
      .then(setCategories)
      .catch(() => setError("Couldn't load your categories. Refresh to retry."));
  }, []);
  useEffect(refresh, [refresh]);

  const count = categories?.length ?? 0;

  return (
    <section className="mt-4 rounded-3xl border border-border bg-card p-6">
      <h2 className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-ink-soft">
        <Tags className="h-3.5 w-3.5" />
        Categories
      </h2>
      <p className="mt-3 text-sm text-ink-soft">
        The types that show as filter chips on your feed. Rename, remove, or add your own.
      </p>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-paper px-4 py-3 text-left transition-colors hover:bg-accent"
      >
        <span className="text-sm font-medium text-ink">Manage categories</span>
        <span className="flex items-center gap-2 text-sm text-ink-soft">
          {categories === null && !error ? "…" : `${count} ${count === 1 ? "category" : "categories"}`}
          <ChevronRight className="h-4 w-4" />
        </span>
      </button>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {open && (
        <CategoryManager
          categories={categories ?? []}
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      )}
    </section>
  );
}

// The editor sheet: bottom sheet on mobile, centered dialog on desktop (matches the
// app's other confirm sheets). Holds an add row, the category list with inline rename,
// and an inline two-step delete so we never stack a modal on top of a modal.
function CategoryManager({
  categories,
  onClose,
  onChanged,
}: {
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitAdd = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    setError(null);
    try {
      await createCategory(name);
      setNewName("");
      onChanged();
    } catch {
      setError("Couldn't add that category. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm md:items-center md:p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl border border-border bg-card shadow-2xl md:rounded-3xl">
        <div className="shrink-0 px-5 pt-5">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-2xl text-ink">Categories</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-accent hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Add a new category */}
        <div className="shrink-0 px-5 pt-4">
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
              }}
              placeholder="Add a category…"
              className="min-w-0 flex-1 rounded-full border border-border bg-paper px-4 py-2.5 text-sm text-ink outline-none transition-colors focus:border-ink/40"
            />
            <button
              type="button"
              onClick={submitAdd}
              disabled={adding || !newName.trim()}
              aria-label="Add category"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>

        {/* The list */}
        <div className="mt-3 flex-1 overflow-y-auto px-5 pb-5">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-soft">
              No categories yet. Add one above, or they'll appear as you save notes.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {categories.map((c) => (
                <CategoryRow key={c.slug} category={c} onChanged={onChanged} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// One category. Three states it can be in: resting (label + count + edit/delete actions),
// renaming (inline input), or confirming-delete (destructive inline prompt). Keeping all
// three inside the row avoids nested modals and keeps the action right where the eye is.
function CategoryRow({ category: c, onChanged }: { category: Category; onChanged: () => void }) {
  const [mode, setMode] = useState<"rest" | "edit" | "delete">("rest");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(noteLabel(c.slug));
    setMode("edit");
  };

  const submitRename = async () => {
    const next = draft.trim();
    if (!next || next === noteLabel(c.slug) || busy) {
      setMode("rest");
      return;
    }
    setBusy(true);
    try {
      await renameCategory(c.slug, next);
      setMode("rest");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    setBusy(true);
    try {
      await deleteCategory(c.slug);
      onChanged(); // row disappears on refresh
    } finally {
      setBusy(false);
    }
  };

  if (mode === "edit") {
    return (
      <li className="flex items-center gap-2 py-2.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitRename();
            if (e.key === "Escape") setMode("rest");
          }}
          className="min-w-0 flex-1 rounded-lg border border-border bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-ink/40"
        />
        <button
          type="button"
          onClick={submitRename}
          disabled={busy}
          aria-label="Save"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setMode("rest")}
          aria-label="Cancel"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-soft transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </li>
    );
  }

  if (mode === "delete") {
    return (
      <li className="flex items-center justify-between gap-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">Delete “{noteLabel(c.slug)}”?</div>
          <div className="text-xs text-ink-soft">
            {c.count > 0
              ? `${c.count} ${c.count === 1 ? "note moves" : "notes move"} to Summary`
              : "Nothing else will change"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("rest")}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submitDelete}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{noteLabel(c.slug)}</div>
        <div className="text-xs text-ink-soft">
          {c.count} {c.count === 1 ? "note" : "notes"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={startEdit}
          aria-label={`Rename ${noteLabel(c.slug)}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-ink-soft transition-colors hover:text-ink"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMode("delete")}
          aria-label={`Delete ${noteLabel(c.slug)}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-ink-soft transition-colors hover:border-destructive/40 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
