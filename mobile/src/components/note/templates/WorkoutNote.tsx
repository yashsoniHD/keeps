import { View, Text } from "react-native";
import {
  Target,
  Gauge,
  Clock,
  Repeat,
  Dumbbell,
  Lightbulb,
  type LucideIcon,
} from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { noteAccent, type NoteAccent } from "@/lib/note-meta";
import { StatGrid, type Stat } from "../StatGrid";
import { SectionHeader } from "../SectionHeader";
import { useAccentColors } from "../colors";

interface Exercise {
  name: string;
  sets?: string;
  reps?: string;
  duration?: string;
  rest?: string;
  formCues?: string;
}

interface WorkoutData {
  goal?: string;
  level?: string;
  duration?: string;
  frequency?: string;
  equipment?: string[];
  structure?: { block: string; items: string[] }[];
  exercises?: Exercise[];
  tips?: string[];
}

// Port of frontend/src/components/note/templates/WorkoutNote.tsx.
export function WorkoutNote({ note }: { note: Note }) {
  const data = note.data as WorkoutData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);

  const stats: Stat[] = (
    [
      { icon: Target, label: "Goal", value: data.goal },
      { icon: Gauge, label: "Level", value: data.level },
      { icon: Clock, label: "Duration", value: data.duration },
      { icon: Repeat, label: "Frequency", value: data.frequency },
    ] as { icon?: LucideIcon; label: string; value?: string }[]
  ).filter((s): s is Stat => Boolean(s.value));

  return (
    <View className="gap-10">
      <StatGrid stats={stats} accent={accent} iconColor={main} capitalize />

      {data.equipment && data.equipment.length > 0 && (
        <View className="flex-row flex-wrap items-center gap-2">
          <Dumbbell size={16} color={main} />
          {data.equipment.map((eq, i) => (
            <View key={i} className="rounded-full border border-border bg-card px-3 py-1">
              <Text className="text-xs capitalize text-ink">{eq}</Text>
            </View>
          ))}
        </View>
      )}

      {(data.structure ?? []).map((block, i) => (
        <View key={i}>
          <SectionHeader>{block.block}</SectionHeader>
          <View className="mt-3 gap-2">
            {(block.items ?? []).map((item, j) => (
              <View key={j} className="flex-row items-start gap-3">
                <View className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${accent.dot}`} />
                <Text className="flex-1 text-ink">{item}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      {data.exercises && data.exercises.length > 0 && (
        <View>
          <SectionHeader>Exercises</SectionHeader>
          <View className="mt-4 gap-4">
            {data.exercises.map((ex, i) => (
              <View key={i} className="rounded-2xl border border-border bg-card p-4">
                <View className="flex-row flex-wrap items-baseline justify-between gap-2">
                  <View className="flex-1 flex-row items-baseline gap-3">
                    <View
                      className={`h-7 w-7 shrink-0 items-center justify-center rounded-full ${accent.dot}`}
                    >
                      <Text className={`text-xs font-medium ${accent.on}`}>{i + 1}</Text>
                    </View>
                    <Text className="flex-1 font-serif text-xl text-ink">{ex.name}</Text>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {ex.sets && <Pill label="Sets" value={ex.sets} accent={accent} />}
                    {ex.reps && <Pill label="Reps" value={ex.reps} accent={accent} />}
                    {ex.duration && <Pill label="Time" value={ex.duration} accent={accent} />}
                    {ex.rest && <Pill label="Rest" value={ex.rest} accent={accent} />}
                  </View>
                </View>
                {ex.formCues && (
                  <Text className="mt-2 pl-10 text-sm text-ink-soft">{ex.formCues}</Text>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

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

function Pill({ label, value, accent }: { label: string; value: string; accent: NoteAccent }) {
  return (
    <View className={`rounded-full px-2.5 py-1 ${accent.chip}`}>
      <Text className="text-xs">
        <Text className="opacity-70">{label} </Text>
        <Text className="font-bold">{value}</Text>
      </Text>
    </View>
  );
}
