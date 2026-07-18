import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Check, Plus, X } from "lucide-react-native";
import { getUserCategories, slugifyCategory } from "@/lib/firestore";
import { updateNote } from "@/lib/api";
import { interopIcon, noteLabel } from "@/lib/note-meta";
import { useAuth } from "@/contexts/auth-context";
import { TypeBadge } from "./TypeBadge";
import { useTokens } from "./colors";

[Check, Plus, X].forEach(interopIcon);

// Tap the category chip to change a note's content_type: a search-or-create list of the
// user's existing categories, or a new one typed in the same field. Port of web
// CategoryEditor — writes go through updateNote (the backend normalises + registers the
// slug); onPatch reflects it optimistically. On mobile the popover becomes a bottom sheet.
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
  const t = useTokens();
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ("");
    if (user)
      getUserCategories(user.uid)
        .then(setCategories)
        .catch(() => {});
  }, [open, user]);

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
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Change category"
        className="active:opacity-80"
      >
        <TypeBadge type={type} size="md" />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-ink/30">
          <Pressable
            className="absolute inset-0"
            onPress={() => setOpen(false)}
            accessibilityLabel="Close"
          />
          <View className="max-h-[70%] rounded-t-3xl border border-border bg-card p-5">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="font-serif text-2xl text-ink">Category</Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityLabel="Close"
                className="h-8 w-8 items-center justify-center rounded-full"
              >
                <X size={16} className="text-ink-soft" />
              </Pressable>
            </View>

            <TextInput
              autoFocus
              value={q}
              onChangeText={setQ}
              onSubmitEditing={() => {
                if (canCreate) apply(q);
                else if (filtered[0]) apply(filtered[0]);
              }}
              placeholder="Search or create…"
              placeholderTextColor={t["ink-soft"]}
              className="rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
            />

            <ScrollView className="mt-3" keyboardShouldPersistTaps="handled">
              {filtered.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => apply(c)}
                  className="flex-row items-center justify-between rounded-xl px-3 py-3 active:bg-accent"
                >
                  <Text className="text-base text-ink">{noteLabel(c)}</Text>
                  {c === type && <Check size={16} className="text-ink-soft" />}
                </Pressable>
              ))}
              {canCreate && (
                <Pressable
                  onPress={() => apply(q)}
                  className="flex-row items-center gap-2 rounded-xl px-3 py-3 active:bg-accent"
                >
                  <Plus size={16} className="text-ink-soft" />
                  <Text className="text-base text-ink">Create &ldquo;{q.trim()}&rdquo;</Text>
                </Pressable>
              )}
              {filtered.length === 0 && !canCreate && (
                <Text className="px-3 py-3 text-base text-ink-soft">No categories</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
