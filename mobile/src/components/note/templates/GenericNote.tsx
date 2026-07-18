import { useEffect, useRef, useState } from "react";
import { Pressable, View, Text, TextInput } from "react-native";
import { Quote, ListChecks, Pencil } from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { interopIcon, noteAccent } from "@/lib/note-meta";
import { updateNote } from "@/lib/api";
import { SectionHeader } from "../SectionHeader";
import { FactsBlock } from "../FactsBlock";
import { DataTable, type TableData } from "../DataTable";
import { NoteMarkdown } from "../Markdown";
import { useAccentColors, useTokens } from "../colors";

interopIcon(Pencil);

interface GenericData {
  body?: string; // free-text note body (save-as-is typed notes) — rendered as prose, editable
  facts?: { label: string; value: string }[];
  sections?: { heading: string; items: string[] }[];
  steps?: string[];
  table?: TableData;
  checklist?: string[];
  quotes?: { text: string; attribution?: string }[];
}

// A short plain-text preview from the body, kept in sync with the feed-card summary
// (mirrors web GenericNote.bodyExcerpt).
function bodyExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

// The free-text body of a save-as-is / typed note. Read-only when no onPatch is wired
// (public view); tap-to-edit for the owner, mirroring EditableTitle: optimistic onPatch,
// revert on failure. Editing also refreshes the card excerpt (ai_summary). Port of web
// GenericNote.NoteBodyBlock.
function NoteBodyBlock({
  note,
  body,
  onPatch,
}: {
  note: Note;
  body: string;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  const t = useTokens();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(body);
  const ref = useRef<TextInput>(null);

  useEffect(() => {
    if (!editing) setValue(body);
  }, [body, editing]);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = async () => {
    const next = value.trim();
    setEditing(false);
    if (!next || next === body) {
      setValue(body); // empty or unchanged → no-op
      return;
    }
    const nextData = { ...(note.data as Record<string, unknown>), body: next };
    const nextSummary = bodyExcerpt(next);
    onPatch?.({ data: nextData, ai_summary: nextSummary }); // optimistic
    try {
      await updateNote(note.id, { data: nextData, ai_summary: nextSummary });
    } catch {
      onPatch?.({ data: note.data, ai_summary: note.ai_summary }); // revert
      setValue(body);
    }
  };

  if (!onPatch) {
    // Read-only (public view).
    return (
      <View>
        <NoteMarkdown>{body}</NoteMarkdown>
      </View>
    );
  }

  if (editing) {
    return (
      <TextInput
        ref={ref}
        value={value}
        onChangeText={setValue}
        onBlur={commit}
        multiline
        textAlignVertical="top"
        selectionColor={t.ink}
        aria-label="Edit note"
        className="min-h-[120px] rounded-2xl border border-border bg-paper p-4 text-sm leading-relaxed text-ink"
      />
    );
  }

  return (
    <Pressable onPress={() => setEditing(true)} accessibilityLabel="Edit note">
      <View className="relative rounded-2xl border border-transparent p-4 active:border-border active:bg-card">
        <View className="absolute right-3 top-3">
          <Pencil size={16} className="text-ink-soft" />
        </View>
        <NoteMarkdown>{body}</NoteMarkdown>
      </View>
    </Pressable>
  );
}

// Renders the composer building blocks the backend emits for AI-invented types (and the
// catch-all for typed / save-as-is notes), with the same block order + treatment as web's
// GenericNote. Port of frontend/src/components/note/templates/GenericNote.tsx.
export function GenericNote({
  note,
  onPatch,
}: {
  note: Note;
  onPatch?: (patch: Partial<Note>) => void;
}) {
  const data = note.data as GenericData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);

  return (
    <View className="gap-10">
      {typeof data.body === "string" && data.body.trim() && (
        <NoteBodyBlock note={note} body={data.body} onPatch={onPatch} />
      )}

      <FactsBlock facts={data.facts} accent={accent} />

      {(data.sections ?? []).map((sec, i) => (
        <View key={i}>
          <SectionHeader>{sec.heading}</SectionHeader>
          <View className="mt-4 gap-3">
            {(sec.items ?? []).map((item, j) => (
              <View key={j} className="flex-row items-start gap-3">
                <View className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <Text className="flex-1 leading-relaxed text-ink">{item}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {data.table && <DataTable table={data.table} accent={accent} />}

      {data.steps && data.steps.length > 0 && (
        <View>
          <SectionHeader>Steps</SectionHeader>
          <View className="mt-4 gap-4">
            {data.steps.map((step, i) => (
              <View key={i} className="flex-row gap-4">
                <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink">
                  <Text className="text-sm font-medium text-paper">{i + 1}</Text>
                </View>
                <Text className="flex-1 pt-0.5 leading-relaxed text-ink">{step}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {data.checklist && data.checklist.length > 0 && (
        <View className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={ListChecks} iconColor={main}>
            Checklist
          </SectionHeader>
          <View className="mt-3 gap-2.5">
            {data.checklist.map((item, i) => (
              <View key={i} className="flex-row items-start gap-3">
                <View className="mt-1 h-4 w-4 shrink-0 rounded border border-border" />
                <Text className="flex-1 text-ink">{item}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {(data.quotes ?? []).map((q, i) => (
        <View key={i} className="relative rounded-2xl border border-border bg-card p-5 pl-12">
          <View className="absolute left-4 top-5">
            <Quote size={20} color={main} />
          </View>
          <Text className="text-[15px] italic leading-relaxed text-ink">&ldquo;{q.text}&rdquo;</Text>
          {q.attribution && <Text className="mt-2 text-xs text-ink-soft">{q.attribution}</Text>}
        </View>
      ))}
    </View>
  );
}
