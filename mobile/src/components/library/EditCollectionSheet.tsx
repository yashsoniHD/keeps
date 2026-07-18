import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";
import { FolderPlus, Pencil, X } from "lucide-react-native";
import type { Collection } from "@clipnote/shared";
import { updateCollectionMeta } from "@/lib/firestore";
import { rescoreCollection } from "@/lib/api";
import { iconByName, interopIcon, paletteAccent } from "@/lib/note-meta";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import { IconPalettePicker } from "./IconPalettePicker";

[FolderPlus, Pencil, X].forEach(interopIcon);

// Edit sheet for a collection's owner-writable presentation fields (name/description/icon/
// palette) — the mobile counterpart of the web RealCollection page's inline rename + the same
// icon/colour pickers NewCollectionSheet uses. Saving a changed name or description re-fires a
// best-effort rescore (renaming/redescribing changes the topic the embedding matches against),
// mirroring the web's silent `rescan(true)` after a rename.
export function EditCollectionSheet({
  collection,
  visible,
  onClose,
}: {
  collection: Collection;
  visible: boolean;
  onClose: () => void;
}) {
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;

  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description ?? "");
  const [icon, setIcon] = useState<string | null>(collection.icon ?? null);
  const [palette, setPalette] = useState<number>(collection.palette ?? 0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form to the live collection each time the sheet opens, so a close-without-saving
  // never leaves stale edits behind on the next open.
  useEffect(() => {
    if (!visible) return;
    setName(collection.name);
    setDescription(collection.description ?? "");
    setIcon(collection.icon ?? null);
    setPalette(collection.palette ?? 0);
    setPickerOpen(false);
    setError(null);
  }, [visible, collection]);

  const accent = paletteAccent(palette);
  const Icon = iconByName(icon) ?? FolderPlus;

  const save = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    const topicChanged =
      n !== collection.name || description.trim() !== (collection.description ?? "");
    try {
      await updateCollectionMeta(collection.id, {
        name: n,
        description: description.trim() || null,
        icon,
        palette,
      });
      if (topicChanged) rescoreCollection(collection.id).catch(() => {}); // best-effort resync
      onClose();
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-ink/30">
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
        <View className="max-h-[88%] rounded-t-3xl border border-border bg-card p-5">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="font-serif text-2xl text-ink">Edit collection</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              className="h-8 w-8 items-center justify-center rounded-full"
            >
              <X size={16} className="text-ink-soft" />
            </Pressable>
          </View>

          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={() => setPickerOpen((o) => !o)}
              accessibilityLabel="Change icon and colour"
              className={`relative h-14 w-14 items-center justify-center rounded-2xl ${accent.dot} ${accent.on}`}
            >
              <Icon size={22} />
              <View className="absolute -bottom-1 -right-1 h-5 w-5 items-center justify-center rounded-full border border-border bg-card">
                <Pencil size={10} className="text-ink-soft" />
              </View>
            </Pressable>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Collection name"
              placeholderTextColor={t["ink-soft"]}
              className="flex-1 rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
            />
          </View>

          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What goes here?"
            placeholderTextColor={t["ink-soft"]}
            multiline
            textAlignVertical="top"
            className="mt-3 min-h-[64px] rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
          />

          {pickerOpen && (
            <View className="mt-3">
              <IconPalettePicker
                icon={icon}
                palette={palette}
                onIcon={setIcon}
                onPalette={setPalette}
              />
            </View>
          )}

          {error && <Text className="mt-3 text-sm text-destructive">{error}</Text>}

          <Pressable
            onPress={save}
            disabled={!name.trim() || busy}
            className={`mt-4 flex-row items-center justify-center gap-2 rounded-full py-3.5 ${
              !name.trim() || busy ? "bg-muted" : "bg-ink"
            }`}
          >
            {busy ? (
              <ActivityIndicator size="small" color={t["ink-soft"]} />
            ) : (
              <Text className={`text-base font-medium ${!name.trim() ? "text-ink-soft" : "text-paper"}`}>
                Save changes
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
