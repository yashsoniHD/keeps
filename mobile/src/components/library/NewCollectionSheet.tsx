import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ArrowRight, Check, FolderPlus, Pencil, Sparkles, X } from "lucide-react-native";
import { createCollection } from "@/lib/firestore";
import { rescoreCollection } from "@/lib/api";
import {
  defaultPaletteFor,
  iconByName,
  interopIcon,
  paletteAccent,
} from "@/lib/note-meta";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import { IconPalettePicker } from "./IconPalettePicker";

[ArrowRight, Check, FolderPlus, Pencil, Sparkles, X].forEach(interopIcon);

// Port of frontend/src/components/library/NewCollectionSheet.tsx as a bottom sheet Modal: name +
// description (the description steers both the rescore embedding and the ingest classifier — an
// empty AI bucket vs. a working one), an icon + colour picker tucked behind the preview chip, then
// awaits the creation-time sweep so success never *looks* broken.
export function NewCollectionSheet({
  uid,
  visible,
  onClose,
}: {
  uid: string;
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [palette, setPalette] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; assigned: number } | null>(null);

  const effectivePalette = palette ?? defaultPaletteFor(name || "collection");
  const accent = paletteAccent(effectivePalette);
  const Icon = iconByName(icon) ?? FolderPlus;

  const reset = () => {
    setName("");
    setDescription("");
    setIcon(null);
    setPalette(null);
    setPickerOpen(false);
    setBusy(false);
    setError(null);
    setCreated(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

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
      let assigned = 0;
      try {
        assigned = (await rescoreCollection(id)).added;
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

  const openCollection = () => {
    if (!created) return;
    const id = created.id;
    reset();
    onClose();
    router.push(`/collection/${id}`);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-ink/30">
        <Pressable className="absolute inset-0" onPress={handleClose} accessibilityLabel="Close" />
        <View className="max-h-[88%] rounded-t-3xl border border-border bg-card p-5">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="font-serif text-2xl text-ink">New collection</Text>
            <Pressable
              onPress={handleClose}
              accessibilityLabel="Close"
              className="h-8 w-8 items-center justify-center rounded-full"
            >
              <X size={16} className="text-ink-soft" />
            </Pressable>
          </View>

          {created ? (
            <View className="items-center">
              <View
                className={`h-14 w-14 items-center justify-center rounded-2xl ${accent.dot} ${accent.on}`}
              >
                <Icon size={24} />
              </View>
              <Text className="mt-4 font-serif text-xl text-ink">
                &ldquo;{name.trim()}&rdquo; is ready
              </Text>
              <Text className="mt-1.5 text-center text-sm text-ink-soft">
                {created.assigned > 0 ? (
                  <>
                    <Check size={14} className="text-success" />
                    {" Swept "}
                    {created.assigned} existing {created.assigned === 1 ? "note" : "notes"} in.
                    New saves that match will land here automatically.
                  </>
                ) : (
                  "No existing notes matched yet. New saves that fit will land here automatically."
                )}
              </Text>
              <Pressable
                onPress={openCollection}
                className="mt-5 w-full flex-row items-center justify-center gap-2 rounded-full bg-ink py-3.5"
              >
                <Text className="text-base font-medium text-paper">Open collection</Text>
                <ArrowRight size={16} className="text-paper" />
              </Pressable>
            </View>
          ) : (
            <>
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
                  autoFocus
                  value={name}
                  onChangeText={setName}
                  placeholder="Name, e.g. Gift ideas"
                  placeholderTextColor={t["ink-soft"]}
                  className="flex-1 rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
                />
              </View>

              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What goes here? e.g. AI tools, LLM articles, ML research"
                placeholderTextColor={t["ink-soft"]}
                multiline
                textAlignVertical="top"
                className="mt-3 min-h-[64px] rounded-2xl border border-border bg-paper px-4 py-3 text-base text-ink"
              />
              <View className="mt-1.5 flex-row items-start gap-1.5 px-1">
                <Sparkles size={13} className="mt-0.5 text-product" />
                <Text className="flex-1 text-xs text-ink-soft">
                  Clipnote uses this to sweep in matching notes now and file future saves here.
                </Text>
              </View>

              {pickerOpen && (
                <View className="mt-3">
                  <IconPalettePicker
                    icon={icon}
                    palette={effectivePalette}
                    onIcon={setIcon}
                    onPalette={setPalette}
                  />
                </View>
              )}

              {error && <Text className="mt-3 text-sm text-destructive">{error}</Text>}

              <Pressable
                onPress={create}
                disabled={!name.trim() || busy}
                className={`mt-4 flex-row items-center justify-center gap-2 rounded-full py-3.5 ${
                  !name.trim() || busy ? "bg-muted" : "bg-ink"
                }`}
              >
                {busy ? (
                  <>
                    <ActivityIndicator size="small" color={t["ink-soft"]} />
                    <Text className="text-base font-medium text-ink-soft">
                      Sweeping in matching notes…
                    </Text>
                  </>
                ) : (
                  <Text
                    className={`text-base font-medium ${!name.trim() ? "text-ink-soft" : "text-paper"}`}
                  >
                    Create collection
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
