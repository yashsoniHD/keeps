import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { Check } from "lucide-react-native";
import { updateNote } from "@/lib/api";
import { interopIcon } from "@/lib/note-meta";
import { useTokens } from "./colors";

interopIcon(Check);

type SaveState = "idle" | "saving" | "saved";

// Owner-only "Your thoughts" annotation, editable + debounced-autosaved via updateNote
// (the private user_note goes through the SAME updateNote PATCH web uses — not a separate
// annotations endpoint; the annotation doc is read-only from the client via getAnnotation).
// Never rendered on the public /p/{id} view. Port of web ThoughtsBlock.
export function ThoughtsBlock({
  noteId,
  value,
  onPatch,
}: {
  noteId: string;
  value: string;
  onPatch?: (patch: { user_note: string }) => void;
}) {
  const t = useTokens();
  const [text, setText] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(value);

  // Adopt the stored value only when navigating between notes — keyed on noteId, NOT value,
  // so a save-driven onPatch flowing a fresh `value` down can't clobber in-flight typing.
  useEffect(() => {
    setText(value);
    lastSaved.current = value;
    setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const scheduleSave = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (next === lastSaved.current) return;
      setState("saving");
      try {
        await updateNote(noteId, { user_note: next });
        lastSaved.current = next;
        onPatch?.({ user_note: next });
        setState("saved");
        setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2000);
      } catch {
        setState("idle"); // keep the text; it retries on the next change
      }
    }, 800);
  };

  return (
    <View className="rounded-2xl border border-border bg-muted p-4">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-sm font-medium text-ink">Your thoughts</Text>
        <View className="flex-row items-center gap-1">
          {state === "saving" && <ActivityIndicator size="small" color={t["ink-soft"]} />}
          {state === "saved" && <Check size={12} className="text-ink-soft" />}
          {(state === "saving" || state === "saved") && (
            <Text className="text-[11px] text-ink-soft">
              {state === "saving" ? "Saving…" : "Saved"}
            </Text>
          )}
        </View>
      </View>
      <TextInput
        value={text}
        onChangeText={(next) => {
          setText(next);
          scheduleSave(next);
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          scheduleSave(text);
        }}
        multiline
        textAlignVertical="top"
        selectionColor={t.ink}
        placeholder="Add a note to your future self: why you saved this, what to try…"
        placeholderTextColor={t["ink-soft"]}
        className="min-h-[64px] text-sm leading-relaxed text-ink"
      />
    </View>
  );
}
