import { View, Text } from "react-native";
import { Play, Clock, Quote, ListChecks } from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { noteAccent } from "@/lib/note-meta";
import { SectionHeader } from "../SectionHeader";
import { FactsBlock } from "../FactsBlock";
import { useAccentColors } from "../colors";

interface SummaryData {
  medium?: string;
  readTime?: string;
  videoLength?: string;
  tldr?: string;
  facts?: { label: string; value: string }[];
  keyPoints?: string[];
  quotes?: { text: string; timestamp?: string }[];
  actionItems?: string[];
}

// Port of frontend/src/components/note/templates/SummaryNote.tsx.
export function SummaryNote({ note }: { note: Note }) {
  const data = note.data as SummaryData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);
  const isVideo = data.medium === "video";

  return (
    <View className="gap-10">
      {/* Medium label + TL;DR read as one unit. */}
      <View>
        <View className="mb-3 flex-row items-center gap-2">
          {isVideo ? <Play size={14} color={main} /> : <Clock size={14} color={main} />}
          <Text className="text-xs uppercase tracking-wider text-ink-soft">
            {isVideo
              ? `Video${data.videoLength ? ` · ${data.videoLength}` : ""}`
              : `${data.medium ?? "Article"}${data.readTime ? ` · ${data.readTime}` : ""}`}
          </Text>
        </View>

        {data.tldr && (
          <View className={`rounded-3xl p-6 ${accent.soft}`}>
            <Text className={`text-xs uppercase tracking-wider ${accent.text}`}>TL;DR</Text>
            <Text className="mt-2 text-base leading-relaxed text-ink">{data.tldr}</Text>
          </View>
        )}
      </View>

      <FactsBlock facts={data.facts} accent={accent} />

      {data.keyPoints && data.keyPoints.length > 0 && (
        <View>
          <SectionHeader>Key points</SectionHeader>
          <View className="mt-4 gap-4">
            {data.keyPoints.map((point, i) => (
              <View key={i} className="flex-row gap-4">
                <Text className={`font-serif text-2xl leading-none ${accent.text}`}>{i + 1}</Text>
                <Text className="flex-1 leading-relaxed text-ink">{point}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {data.quotes && data.quotes.length > 0 && (
        <View>
          <SectionHeader>Highlights</SectionHeader>
          <View className="mt-4 gap-4">
            {data.quotes.map((q, i) => (
              <View key={i} className="relative rounded-2xl border border-border bg-card p-5 pl-12">
                <View className="absolute left-4 top-5">
                  <Quote size={20} color={main} />
                </View>
                <Text className="text-[15px] italic leading-relaxed text-ink">
                  &ldquo;{q.text}&rdquo;
                </Text>
                {q.timestamp && (
                  <Text className="mt-2 font-mono text-xs text-ink-soft">{q.timestamp}</Text>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {data.actionItems && data.actionItems.length > 0 && (
        <View className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={ListChecks} iconColor={main}>
            Action items
          </SectionHeader>
          <View className="mt-3 gap-2">
            {data.actionItems.map((item, i) => (
              <View key={i} className="flex-row items-start gap-3">
                <View className={`mt-1 h-4 w-4 shrink-0 rounded border ${accent.border}`} />
                <Text className="flex-1 text-ink">{item}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
