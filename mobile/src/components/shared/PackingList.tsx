import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, Share } from "react-native";
import { createMMKV } from "react-native-mmkv";
import { Check, Eraser, Luggage, Plus, Share2, X } from "lucide-react-native";
import { paletteAccent } from "@/lib/note-meta";
import { useTokens } from "@/components/note/colors";

// The packing checklist always renders in the trip accent (palette index 8), matching the web
// PackingList's hard-coded `paletteAccent(8)` — independent of the note's own content-type accent.
const TRIP = paletteAccent(8);

// Port note: web persisted the list in localStorage under the caller's `storageKey`. RN has no
// localStorage, so the list lives in a small MMKV instance (react-native-mmkv v4 createMMKV
// factory), one instance for every packing list, keyed by the same string the web used
// (`note-packing:{noteId}`). Only difference: MMKV survives cold starts, which is harmless for a
// scratch list.
const storage = createMMKV({ id: "clipnote-packing" });

interface PackItem {
  text: string;
  checked: boolean;
}

function load(storageKey: string, initialItems?: string[]): PackItem[] {
  try {
    const raw = storage.getString(storageKey);
    if (raw) return JSON.parse(raw) as PackItem[];
  } catch {
    // corrupt / absent — fall through to the seed
  }
  // First open for this note: seed from any backend-supplied packing items (none in today's
  // itinerary schema, so this is normally an empty scratch list, exactly like web).
  return (initialItems ?? []).map((text) => ({ text, checked: false }));
}

// A per-trip packing checklist. Fully client-side: items live in MMKV under the caller's
// `storageKey` (no backend), so it's the user's own scratch list for what to bring. Add, tick off,
// remove, clear packed, and share what's still to pack. Callers pass a stable key so a half-built
// list survives a reload — itinerary notes use `note-packing:{noteId}`. Port of
// frontend/src/components/shared/PackingList.tsx.
export function PackingList({
  storageKey,
  initialItems,
}: {
  storageKey: string;
  initialItems?: string[];
}) {
  const t = useTokens();
  const [items, setItems] = useState<PackItem[]>(() => load(storageKey, initialItems));
  const [draft, setDraft] = useState("");

  // Reload when the key changes (the component may be reused across note detail pages).
  useEffect(() => setItems(load(storageKey, initialItems)), [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next: PackItem[]) => {
    setItems(next);
    try {
      storage.set(storageKey, JSON.stringify(next));
    } catch {
      // storage failure — the list still works for this session
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
      await Share.share({ title: "Packing list", message: text });
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  };

  return (
    <View className={`mt-10 rounded-2xl border border-border bg-card p-5`}>
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Luggage size={16} color={t.trip} />
          <Text className="font-serif text-xl text-ink">Packing list</Text>
          {items.length > 0 && (
            <Text className="text-sm text-ink-soft">{`· ${remaining} to pack`}</Text>
          )}
        </View>
        {items.some((it) => it.checked) && (
          <Pressable
            onPress={clearChecked}
            className="flex-row items-center gap-1.5 rounded active:opacity-70"
          >
            <Eraser size={14} color={t["ink-soft"]} />
            <Text className="text-xs text-ink-soft">Clear packed</Text>
          </Pressable>
        )}
      </View>

      {items.length > 0 && (
        <View className="mt-3 gap-1">
          {items.map((it, idx) => (
            <View key={idx} className="flex-row items-center gap-3">
              <Pressable
                onPress={() => toggle(idx)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: it.checked }}
                accessibilityLabel={it.checked ? "Mark as not packed" : "Mark as packed"}
                className={`h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  it.checked ? `border-transparent ${TRIP.dot}` : "border-border bg-background"
                }`}
              >
                {it.checked && <Check size={14} color={t["trip-on"]} />}
              </Pressable>
              <Text
                className={`flex-1 text-sm ${it.checked ? "text-ink-soft line-through" : "text-ink"}`}
              >
                {it.text}
              </Text>
              <Pressable
                onPress={() => remove(idx)}
                accessibilityLabel="Remove item"
                hitSlop={8}
                className="shrink-0 rounded p-1 active:opacity-70"
              >
                <X size={14} color={t["ink-soft"]} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View className="mt-3 flex-row items-center gap-2">
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          returnKeyType="done"
          placeholder="Add something to pack"
          placeholderTextColor={t["ink-soft"]}
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-ink"
        />
        <Pressable
          onPress={add}
          disabled={!draft.trim()}
          accessibilityLabel="Add item"
          className={`h-9 w-9 shrink-0 items-center justify-center rounded-full ${TRIP.dot} ${
            draft.trim() ? "" : "opacity-50"
          }`}
        >
          <Plus size={16} color={t["trip-on"]} />
        </Pressable>
        {remaining > 0 && (
          <Pressable
            onPress={share}
            accessibilityLabel="Share packing list"
            className="h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background active:opacity-70"
          >
            <Share2 size={16} color={t["ink-soft"]} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
