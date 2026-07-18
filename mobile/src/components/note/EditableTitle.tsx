import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Pencil } from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { updateNote } from "@/lib/api";
import { interopIcon } from "@/lib/note-meta";
import { useTokens } from "./colors";

interopIcon(Pencil);

// Tap-to-edit note title, mirroring web NoteHeader.EditableTitle: optimistic onPatch +
// revert on failure, submit/blur commits. Owner-only — the public view renders the title
// as plain text. RN has no Escape key, so blur is the only cancel/commit path (submit too).
export function EditableTitle({
  note,
  onPatch,
}: {
  note: Note;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  const t = useTokens();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note.title);
  const ref = useRef<TextInput>(null);

  // Reflect live updates (e.g. a re-extract refresh) while not actively editing.
  useEffect(() => {
    if (!editing) setValue(note.title);
  }, [note.title, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = async () => {
    const next = value.trim();
    setEditing(false);
    if (!next || next === note.title) {
      setValue(note.title); // empty or unchanged → no-op
      return;
    }
    onPatch?.({ title: next }); // optimistic
    try {
      await updateNote(note.id, { title: next });
    } catch {
      onPatch?.({ title: note.title }); // revert on failure
      setValue(note.title);
    }
  };

  if (editing) {
    return (
      <TextInput
        ref={ref}
        value={value}
        onChangeText={setValue}
        onBlur={commit}
        onSubmitEditing={commit}
        multiline
        blurOnSubmit
        submitBehavior="blurAndSubmit"
        selectionColor={t.ink}
        aria-label="Edit title"
        className="font-serif text-4xl leading-tight text-ink"
      />
    );
  }

  return (
    <Pressable onPress={() => setEditing(true)} accessibilityLabel="Rename note">
      <View className="flex-row items-start gap-2">
        <Text className="flex-1 font-serif text-4xl leading-tight text-ink">{note.title}</Text>
        <Pencil size={18} className="mt-2 text-ink-soft" />
      </View>
    </Pressable>
  );
}
