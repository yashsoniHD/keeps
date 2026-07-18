import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, ChevronRight, Pencil, Plus, Tags, Trash2, X } from "lucide-react-native";

import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
  type CategoryInfo,
} from "@/lib/api";
import { slugifyCategory } from "@/lib/firestore";
import {
  iconByName,
  interopIcon,
  noteAccent,
  noteIcon,
  noteLabel,
  paletteAccent,
  setCategoryOverrides,
  type CategoryMeta,
} from "@/lib/note-meta";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import { IconPalettePicker } from "@/components/library/IconPalettePicker";

// className styling on SVG icons requires interop registration (see note-meta / settings).
[Check, ChevronRight, Pencil, Plus, Tags, Trash2, X].forEach(interopIcon);

// Push the fetched icon/colour overrides into note-meta's module-level registry so
// noteAccent/noteIcon reflect a user's picks app-wide (feed cards, chips, badges). The web
// keeps this current via a users-doc snapshot (CategoryMetaProvider); on mobile the manager
// is the write path, so we re-apply the full authoritative set after every load/edit.
function applyOverrides(cats: CategoryInfo[]) {
  const map: Record<string, CategoryMeta> = {};
  for (const c of cats) {
    if (c.icon != null || c.palette != null) {
      map[c.slug] = {
        icon: c.icon ?? undefined,
        palette: c.palette ?? undefined,
      };
    }
  }
  setCategoryOverrides(map);
}

// The category icon swatch (opens the picker). Shows the live look: the pinned icon/colour if
// set, else what's auto-derived from the (preview) slug.
function StyleSwatch({
  icon,
  palette,
  slug,
  onPress,
}: {
  icon: string | null;
  palette: number | null;
  slug: string;
  onPress: () => void;
}) {
  const accent = palette != null ? paletteAccent(palette) : noteAccent(slug);
  const Icon = iconByName(icon) ?? noteIcon(slug);
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Choose icon and colour"
      className={`h-10 w-10 shrink-0 items-center justify-center rounded-full ${accent.chip}`}
    >
      <Icon size={18} />
    </Pressable>
  );
}

// Settings entry: a "Manage categories" row (count + chevron) that opens the editor sheet.
export function CategoriesSection() {
  const [categories, setCategories] = useState<CategoryInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const cats = await listCategories();
      setCategories(cats);
      applyOverrides(cats);
    } catch {
      setError("Couldn't load your categories.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const count = categories?.length ?? 0;

  return (
    <View>
      <Text className="mb-2 mt-6 px-1 text-xs uppercase tracking-wider text-ink-soft">
        Categories
      </Text>

      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-4 active:opacity-80"
      >
        <View className="h-10 w-10 items-center justify-center rounded-full bg-summary-soft">
          <Tags size={18} className="text-summary-chip" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-medium text-ink">Manage categories</Text>
          <Text className="text-sm text-ink-soft">
            {categories === null && !error
              ? "…"
              : `${count} ${count === 1 ? "category" : "categories"}`}
          </Text>
        </View>
        <ChevronRight size={20} className="text-ink-soft" />
      </Pressable>

      <Text className="mt-2 px-1 text-xs text-ink-soft">
        The types that show as filter chips on your feed. Rename, remove, or add your own.
      </Text>

      {error ? <Text className="mt-2 px-1 text-sm text-destructive">{error}</Text> : null}

      <CategoryManager
        visible={open}
        categories={categories ?? []}
        onClose={() => setOpen(false)}
        onChanged={refresh}
      />
    </View>
  );
}

// The editor sheet: an add row on top, then the scrollable category list with inline
// rename + two-step delete (which moves the notes to another category — never destroys them).
function CategoryManager({
  visible,
  categories,
  onClose,
  onChanged,
}: {
  visible: boolean;
  categories: CategoryInfo[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;

  const [newName, setNewName] = useState("");
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [newPalette, setNewPalette] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewSlug = slugifyCategory(newName) || "summary";

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
      await onChanged();
    } catch {
      setError("Couldn't add that category. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-ink/30">
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
        <View className="max-h-[88%] rounded-t-3xl border border-border bg-card">
          <View className="flex-row items-center justify-between px-5 pb-2 pt-5">
            <Text className="font-serif text-2xl text-ink">Categories</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              className="h-8 w-8 items-center justify-center rounded-full"
            >
              <X size={16} className="text-ink-soft" />
            </Pressable>
          </View>

          {/* Add a new category */}
          <View className="px-5 pt-2">
            <View className="flex-row items-center gap-2">
              <StyleSwatch
                icon={newIcon}
                palette={newPalette}
                slug={previewSlug}
                onPress={() => setPickerOpen((v) => !v)}
              />
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Add a category"
                placeholderTextColor={t["ink-soft"]}
                onSubmitEditing={submitAdd}
                className="min-w-0 flex-1 rounded-full border border-border bg-paper px-4 py-2.5 text-sm text-ink"
              />
              <Pressable
                onPress={submitAdd}
                disabled={adding || !newName.trim()}
                accessibilityLabel="Add category"
                className={`h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  adding || !newName.trim() ? "bg-muted" : "bg-ink"
                }`}
              >
                {adding ? (
                  <ActivityIndicator size="small" color={t["ink-soft"]} />
                ) : (
                  <Plus size={20} className={!newName.trim() ? "text-ink-soft" : "text-paper"} />
                )}
              </Pressable>
            </View>
            {pickerOpen ? (
              <View className="mt-3">
                <IconPalettePicker
                  icon={newIcon}
                  palette={newPalette}
                  onIcon={setNewIcon}
                  onPalette={setNewPalette}
                />
              </View>
            ) : null}
            {error ? <Text className="mt-2 text-sm text-destructive">{error}</Text> : null}
          </View>

          {/* The list */}
          <ScrollView className="mt-3 px-5" contentContainerClassName="pb-8">
            {categories.length === 0 ? (
              <Text className="py-6 text-center text-sm text-ink-soft">
                No categories yet. Add one above, or they'll appear as you save notes.
              </Text>
            ) : (
              categories.map((c, i) => (
                <CategoryRow
                  key={c.slug}
                  category={c}
                  others={categories.filter((o) => o.slug !== c.slug)}
                  first={i === 0}
                  onChanged={onChanged}
                />
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// One category: resting (icon + label + count + edit/delete), renaming (inline input + picker),
// or confirming delete (with a "move notes to" target so the notes are never lost).
function CategoryRow({
  category: c,
  others,
  first,
  onChanged,
}: {
  category: CategoryInfo;
  others: CategoryInfo[];
  first: boolean;
  onChanged: () => Promise<void>;
}) {
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;

  const [mode, setMode] = useState<"rest" | "edit" | "delete">("rest");
  const [draft, setDraft] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [palette, setPalette] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const border = first ? "" : "border-t border-border";

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
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // move_to is optional; omitting it moves the notes to "Summary" server-side. Picking a
      // target folds this category's notes into that one (the categories merge path).
      await deleteCategory(c.slug, moveTo ?? undefined);
      await onChanged(); // row disappears on refresh
    } finally {
      setBusy(false);
    }
  };

  if (mode === "edit") {
    const preview = slugifyCategory(draft) || c.slug;
    return (
      <View className={`py-3 ${border}`}>
        <View className="flex-row items-center gap-2">
          <StyleSwatch
            icon={icon}
            palette={palette}
            slug={preview}
            onPress={() => setPickerOpen((v) => !v)}
          />
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitEdit}
            placeholderTextColor={t["ink-soft"]}
            className="min-w-0 flex-1 rounded-full border border-border bg-paper px-4 py-2.5 text-sm text-ink"
          />
          <Pressable
            onPress={submitEdit}
            disabled={busy}
            accessibilityLabel="Save"
            className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink"
          >
            {busy ? (
              <ActivityIndicator size="small" color={t.paper} />
            ) : (
              <Check size={16} className="text-paper" />
            )}
          </Pressable>
          <Pressable
            onPress={() => setMode("rest")}
            accessibilityLabel="Cancel"
            className="h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border"
          >
            <X size={16} className="text-ink-soft" />
          </Pressable>
        </View>
        {pickerOpen ? (
          <View className="mt-3">
            <IconPalettePicker icon={icon} palette={palette} onIcon={setIcon} onPalette={setPalette} />
          </View>
        ) : null}
      </View>
    );
  }

  if (mode === "delete") {
    const targetLabel = moveTo ? noteLabel(moveTo) : "Summary";
    return (
      <View className={`py-3 ${border}`}>
        <Text className="text-sm font-medium text-ink">Delete &ldquo;{noteLabel(c.slug)}&rdquo;?</Text>
        <Text className="mt-0.5 text-xs text-ink-soft">
          {c.count > 0
            ? `${c.count} ${c.count === 1 ? "note moves" : "notes move"} to ${targetLabel}. Nothing is deleted.`
            : "Nothing else will change."}
        </Text>

        {c.count > 0 && others.length > 0 ? (
          <View className="mt-3 flex-row flex-wrap gap-1.5">
            {others.map((o) => {
              const active = moveTo === o.slug;
              return (
                <Pressable
                  key={o.slug}
                  onPress={() => setMoveTo(active ? null : o.slug)}
                  accessibilityState={{ selected: active }}
                  className={`rounded-full border px-3 py-1.5 ${
                    active ? "border-ink bg-ink" : "border-border"
                  }`}
                >
                  <Text className={`text-xs font-medium ${active ? "text-paper" : "text-ink"}`}>
                    {noteLabel(o.slug)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View className="mt-3 flex-row items-center gap-2">
          <Pressable
            onPress={() => {
              setMoveTo(null);
              setMode("rest");
            }}
            className="rounded-full border border-border px-4 py-2"
          >
            <Text className="text-xs font-medium text-ink">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={submitDelete}
            disabled={busy}
            className={`flex-row items-center gap-1.5 rounded-full px-4 py-2 ${
              busy ? "bg-muted" : "bg-destructive"
            }`}
          >
            {busy ? (
              <ActivityIndicator size="small" color={t.paper} />
            ) : (
              <Trash2 size={14} className="text-destructive-foreground" />
            )}
            <Text className="text-xs font-medium text-destructive-foreground">Delete</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const accent = c.palette != null ? paletteAccent(c.palette) : noteAccent(c.slug);
  const Icon = iconByName(c.icon) ?? noteIcon(c.slug);
  return (
    <View className={`flex-row items-center gap-3 py-3 ${border}`}>
      <View className={`h-9 w-9 shrink-0 items-center justify-center rounded-full ${accent.chip}`}>
        <Icon size={16} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium text-ink" numberOfLines={1}>
          {noteLabel(c.slug)}
        </Text>
        <Text className="text-xs text-ink-soft">
          {c.count} {c.count === 1 ? "note" : "notes"}
        </Text>
      </View>
      <Pressable
        onPress={startEdit}
        accessibilityLabel={`Rename ${noteLabel(c.slug)}`}
        hitSlop={6}
        className="h-9 w-9 items-center justify-center rounded-full border border-border"
      >
        <Pencil size={14} className="text-ink-soft" />
      </Pressable>
      <Pressable
        onPress={() => {
          setMoveTo(null);
          setMode("delete");
        }}
        accessibilityLabel={`Delete ${noteLabel(c.slug)}`}
        hitSlop={6}
        className="h-9 w-9 items-center justify-center rounded-full border border-border"
      >
        <Trash2 size={14} className="text-destructive" />
      </Pressable>
    </View>
  );
}
