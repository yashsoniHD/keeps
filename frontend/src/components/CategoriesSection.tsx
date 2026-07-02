import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, Loader2, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  type CategoryInfo,
} from "@/lib/api";
import {
  noteLabel,
  noteIcon,
  noteAccent,
  paletteAccent,
  iconByName,
  CATEGORY_ICONS,
  PALETTE_DOTS,
} from "@/lib/note-meta";
import { slugifyCategory } from "@/lib/firestore";
import { FOCUS_RING } from "@/lib/ui";

type Category = CategoryInfo;

// The round icon swatch that opens the style picker. Shows the live look the category will
// have: the picked icon/colour if set, else the value auto-derived from its (preview) slug.
function StyleSwatch({
  icon,
  palette,
  slug,
  onClick,
}: {
  icon: string | null;
  palette: number | null;
  slug: string;
  onClick: () => void;
}) {
  const accent = palette != null ? paletteAccent(palette) : noteAccent(slug);
  const Icon = iconByName(icon) ?? noteIcon(slug);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Choose icon and colour"
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 ${accent.chip} ${FOCUS_RING}`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

// The expandable picker panel: a grid of icons over a row of colour swatches. Full-width so
// it sits below the row it belongs to rather than crowding the inline controls.
function StylePanel({
  icon,
  palette,
  slug,
  onIcon,
  onPalette,
}: {
  icon: string | null;
  palette: number | null;
  slug: string;
  onIcon: (name: string) => void;
  onPalette: (index: number) => void;
}) {
  const effectivePalette = palette ?? PALETTE_DOTS.indexOf(noteAccent(slug).dot);
  return (
    <div className="mt-3 rounded-2xl border border-border bg-paper p-3">
      <div className="grid grid-cols-8 gap-1">
        {Object.entries(CATEGORY_ICONS).map(([name, Icon]) => (
          <button
            key={name}
            type="button"
            onClick={() => onIcon(name)}
            aria-label={name}
            aria-pressed={icon === name}
            className={`inline-flex aspect-square items-center justify-center rounded-lg transition-colors ${
              icon === name ? "bg-brand text-brand-foreground" : "text-ink-soft hover:bg-accent"
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        {PALETTE_DOTS.map((dot, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPalette(i)}
            aria-label={`Colour ${i + 1}`}
            aria-pressed={effectivePalette === i}
            className={`h-7 w-7 rounded-full ${dot} ring-2 ring-offset-2 ring-offset-paper transition-all ${
              effectivePalette === i ? "ring-ink" : "ring-transparent hover:ring-border"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

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
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [newPalette, setNewPalette] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitAdd = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    setError(null);
    try {
      await createCategory(name, {
        icon: newIcon ?? undefined,
        palette: newPalette ?? undefined,
      });
      setNewName("");
      setNewIcon(null);
      setNewPalette(null);
      setPickerOpen(false);
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
            <StyleSwatch
              icon={newIcon}
              palette={newPalette}
              slug={slugifyCategory(newName) || "summary"}
              onClick={() => setPickerOpen((v) => !v)}
            />
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
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
            </button>
          </div>
          {pickerOpen && (
            <StylePanel
              icon={newIcon}
              palette={newPalette}
              slug={slugifyCategory(newName) || "summary"}
              onIcon={setNewIcon}
              onPalette={setNewPalette}
            />
          )}
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
  const [icon, setIcon] = useState<string | null>(null);
  const [palette, setPalette] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(noteLabel(c.slug));
    setIcon(c.icon ?? null);
    setPalette(c.palette ?? null);
    setPickerOpen(false);
    setMode("edit");
  };

  const submitEdit = async () => {
    if (busy) return;
    const next = draft.trim();
    const nameChanged = !!next && next !== noteLabel(c.slug);
    const iconChanged = icon !== (c.icon ?? null);
    const paletteChanged = palette !== (c.palette ?? null);
    if (!nameChanged && !iconChanged && !paletteChanged) {
      setMode("rest");
      return;
    }
    setBusy(true);
    try {
      await updateCategory(c.slug, {
        new_name: nameChanged ? next : undefined,
        // The picker only ever sets a value (no "clear"), so null means "leave as-is".
        icon: iconChanged ? (icon ?? undefined) : undefined,
        palette: paletteChanged ? (palette ?? undefined) : undefined,
      });
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
    const previewSlug = slugifyCategory(draft) || c.slug;
    return (
      <li className="py-2.5">
        <div className="flex items-center gap-2">
          <StyleSwatch
            icon={icon}
            palette={palette}
            slug={previewSlug}
            onClick={() => setPickerOpen((v) => !v)}
          />
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitEdit();
              if (e.key === "Escape") setMode("rest");
            }}
            className="min-w-0 flex-1 rounded-lg border border-border bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-ink/40"
          />
          <button
            type="button"
            onClick={submitEdit}
            disabled={busy}
            aria-label="Save"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
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
        </div>
        {pickerOpen && (
          <StylePanel
            icon={icon}
            palette={palette}
            slug={previewSlug}
            onIcon={setIcon}
            onPalette={setPalette}
          />
        )}
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

  // Use this row's own fetched override (authoritative) rather than the global registry,
  // so the list is self-consistent the instant a refetch lands — no snapshot-timing race.
  const accent = c.palette != null ? paletteAccent(c.palette) : noteAccent(c.slug);
  const Icon = iconByName(c.icon) ?? noteIcon(c.slug);
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${accent.chip}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">{noteLabel(c.slug)}</div>
          <div className="text-xs text-ink-soft">
            {c.count} {c.count === 1 ? "note" : "notes"}
          </div>
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
