import { View, Text, Pressable } from "react-native";
import * as Linking from "expo-linking";
import {
  Clock,
  Timer,
  Flame,
  Users,
  Gauge,
  Globe,
  Zap,
  Lightbulb,
  type LucideIcon,
} from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { noteAccent } from "@/lib/note-meta";
import { StatGrid, type Stat } from "../StatGrid";
import { SectionHeader } from "../SectionHeader";
import { useAccentColors } from "../colors";

interface RecipeData {
  totalTime?: string;
  prepTime?: string;
  cookTime?: string;
  servings?: string;
  difficulty?: string;
  cuisine?: string;
  calories?: string;
  ingredients?: { group?: string; items: string[] }[];
  steps?: string[];
  tips?: string[];
}

// Port of frontend/src/components/note/templates/RecipeNote.tsx. Web's Ingredients | Method
// two-column grid collapses to a single stacked column on a phone. Web has no ingredient
// check-off (just bullet dots), so there's none here either.
export function RecipeNote({ note }: { note: Note }) {
  const data = note.data as RecipeData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);

  // Older backfill stubs never got the recipe extracted — render a clear empty state.
  const hasContent =
    (data.ingredients?.some((g) => (g.items?.length ?? 0) > 0) ?? false) ||
    (data.steps?.length ?? 0) > 0;
  if (!hasContent) {
    return (
      <View className="items-center rounded-2xl border border-border bg-card p-6">
        <Text className="text-center text-ink">We couldn&rsquo;t pull the recipe details from this one.</Text>
        {note.source_url && (
          <Pressable
            onPress={() => Linking.openURL(note.source_url).catch(() => {})}
            className="mt-4 flex-row items-center gap-2 rounded-full bg-ink px-4 py-2 active:opacity-90"
          >
            <Globe size={16} color="#fff" />
            <Text className="text-sm font-medium text-paper">Open the source</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const stats: Stat[] = (
    [
      { icon: Clock, label: "Total", value: data.totalTime },
      { icon: Timer, label: "Prep", value: data.prepTime },
      { icon: Flame, label: "Cook", value: data.cookTime },
      { icon: Users, label: "Serves", value: data.servings },
      { icon: Gauge, label: "Effort", value: data.difficulty },
      { icon: Globe, label: "Cuisine", value: data.cuisine },
      { icon: Zap, label: "Calories", value: data.calories },
    ] as { icon?: LucideIcon; label: string; value?: string }[]
  ).filter((s): s is Stat => Boolean(s.value));

  return (
    <View className="gap-10">
      <StatGrid stats={stats} accent={accent} iconColor={main} capitalize />

      <View>
        <SectionHeader>Ingredients</SectionHeader>
        <View className="mt-4 gap-5">
          {(data.ingredients ?? []).map((group, gi) => (
            <View key={gi}>
              {group.group && (
                <Text className="mb-2 text-xs uppercase tracking-wider text-ink-soft">
                  {group.group}
                </Text>
              )}
              <View className="gap-2">
                {(group.items ?? []).map((item, i) => (
                  <View key={i} className="flex-row items-start gap-3">
                    <View className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                    <Text className="flex-1 text-ink">{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </View>

      <View>
        <SectionHeader>Method</SectionHeader>
        <View className="mt-4 gap-5 border-l border-border pl-5">
          {(data.steps ?? []).map((step, i) => (
            <View key={i} className="flex-row gap-4">
              <View className={`h-8 w-8 shrink-0 items-center justify-center rounded-full ${accent.dot}`}>
                <Text className="text-sm font-medium text-paper">{i + 1}</Text>
              </View>
              <Text className="flex-1 pt-0.5 leading-relaxed text-ink">{step}</Text>
            </View>
          ))}
        </View>
      </View>

      {data.tips && data.tips.length > 0 && (
        <View className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={Lightbulb} iconColor={main}>
            Tips
          </SectionHeader>
          <View className="mt-3 gap-2">
            {data.tips.map((tip, i) => (
              <View key={i} className="flex-row items-start gap-3">
                <View className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <Text className="flex-1 text-ink">{tip}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
