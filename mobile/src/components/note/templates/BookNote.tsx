import { View, Text } from "react-native";
import { BookOpen, Users } from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { noteAccent } from "@/lib/note-meta";
import { SectionHeader } from "../SectionHeader";
import { FactsBlock } from "../FactsBlock";
import { useAccentColors } from "../colors";

// Matches the backend `book` schema (services/gemini.py TYPE_PROMPTS["book"]). Port of
// frontend/src/components/note/templates/BookNote.tsx.
interface BookData {
  author?: string;
  genre?: string;
  pages?: string;
  published?: string;
  facts?: { label: string; value: string }[];
  premise?: string;
  keyIdeas?: string[];
  whoShouldRead?: string;
}

export function BookNote({ note }: { note: Note }) {
  const data = note.data as BookData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);

  const meta = [data.author, data.genre, data.published, data.pages && `${data.pages} pages`]
    .filter(Boolean)
    .join(" · ");

  return (
    <View className="gap-10">
      {meta.length > 0 && <Text className="text-ink-soft">{meta}</Text>}

      {data.premise && <Text className="text-lg leading-relaxed text-ink">{data.premise}</Text>}

      <FactsBlock facts={data.facts} accent={accent} />

      {data.keyIdeas && data.keyIdeas.length > 0 && (
        <View>
          <SectionHeader icon={BookOpen} iconColor={main}>
            Key ideas
          </SectionHeader>
          <View className="mt-4 gap-3">
            {data.keyIdeas.map((item, i) => (
              <View key={i} className="flex-row items-start gap-3">
                <View className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <Text className="flex-1 leading-relaxed text-ink">{item}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {data.whoShouldRead && (
        <View className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={Users} iconColor={main}>
            Who should read it
          </SectionHeader>
          <Text className="mt-2 leading-relaxed text-ink">{data.whoShouldRead}</Text>
        </View>
      )}
    </View>
  );
}
