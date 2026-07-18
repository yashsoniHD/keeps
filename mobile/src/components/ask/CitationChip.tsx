import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import type { AskCitation } from "@/lib/api";

// A grounded citation under an Ask AI answer: type icon + title → opens the note. Port of
// web AskChat's CitationChip (icon chip + title + type label). Navigates to the underlying
// note (ref_id when present, else id).
export function CitationChip({ citation }: { citation: AskCitation }) {
  const router = useRouter();
  const accent = noteAccent(citation.content_type);
  const Icon = noteIcon(citation.content_type);
  return (
    <Pressable
      onPress={() => router.push(`/note/${citation.ref_id || citation.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open note: ${citation.title}`}
      className="max-w-[240px] flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 active:opacity-80"
    >
      <View className={`h-6 w-6 shrink-0 items-center justify-center rounded-md ${accent.chip}`}>
        <Icon size={14} className={accent.text} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-medium text-ink" numberOfLines={1}>
          {citation.title}
        </Text>
        <Text className="text-[11px] text-ink-soft" numberOfLines={1}>
          {noteLabel(citation.content_type)}
        </Text>
      </View>
    </Pressable>
  );
}
