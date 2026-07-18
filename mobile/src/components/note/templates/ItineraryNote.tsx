import { View, Text } from "react-native";
import { MapPin, Calendar, Wallet, Sun, Lightbulb, type LucideIcon } from "lucide-react-native";
import type { Note, TripDay } from "@clipnote/shared";
import { noteAccent } from "@/lib/note-meta";
import { useAccentColors } from "../colors";
import { StatGrid, type Stat } from "../StatGrid";
import { SectionHeader } from "../SectionHeader";
import { TripMap } from "@/components/shared/TripMap";
import { PackingList } from "@/components/shared/PackingList";

// Itinerary / trip note. Stops carry lat/lng when backend enrichment geocoded them — that's what
// drives the map. Port of frontend/src/components/note/templates/ItineraryNote.tsx.
interface ItineraryData {
  destination?: string;
  duration?: string;
  budget?: string;
  bestSeason?: string;
  days?: TripDay[];
  tips?: string[];
  // Not in today's schema, but seeded into the packing list if a backend ever supplies it.
  packing?: string[];
  packingList?: string[];
}

export function ItineraryNote({ note }: { note: Note }) {
  const data = note.data as ItineraryData;
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);

  const stats: Stat[] = (
    [
      { icon: MapPin, label: "Where", value: data.destination },
      { icon: Calendar, label: "Duration", value: data.duration },
      { icon: Wallet, label: "Budget", value: data.budget },
      { icon: Sun, label: "Best season", value: data.bestSeason },
    ] as { icon?: LucideIcon; label: string; value?: string }[]
  ).filter((s): s is Stat => Boolean(s.value));

  const days = data.days ?? [];

  return (
    <View className="gap-10">
      <StatGrid stats={stats} accent={accent} iconColor={main} />

      {/* Live map of geocoded stops — TripMap renders nothing without coordinates. */}
      {days.length > 0 && <TripMap days={days} />}

      <View className="gap-10">
        {days.map((day, di) => (
          <View key={day.day ?? di} className="relative">
            <View className="mb-5 flex-row items-baseline gap-3">
              <Text className={`font-serif text-5xl ${accent.text}`}>
                {/* AI-shaped data can omit `day` despite the type — fall back to position. */}
                {String(day.day ?? di + 1).padStart(2, "0")}
              </Text>
              {day.title ? <Text className="font-serif text-2xl text-ink">{day.title}</Text> : null}
            </View>

            <View className="gap-5 border-l-2 border-dashed border-border pl-6">
              {(day.stops ?? []).map((stop, i) => (
                <View key={i} className="relative">
                  <View
                    className={`absolute -left-[1.85rem] top-2 h-3 w-3 rounded-full border-2 bg-paper ${accent.border}`}
                  />
                  <View className="flex-row flex-wrap items-baseline gap-2">
                    {stop.time ? (
                      <Text className={`rounded-full px-2 py-0.5 font-mono text-xs ${accent.chip}`}>
                        {stop.time}
                      </Text>
                    ) : null}
                    <Text className="font-serif text-xl text-ink">{stop.place}</Text>
                  </View>
                  {stop.note ? <Text className="mt-1 text-ink-soft">{stop.note}</Text> : null}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {data.tips && data.tips.length > 0 && (
        <View className="rounded-2xl border border-border bg-card p-5">
          <SectionHeader icon={Lightbulb} iconColor={main}>
            Good to know
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

      {/* Client-side scratch list (MMKV) — what to bring on this trip. */}
      <PackingList
        storageKey={`note-packing:${note.id}`}
        initialItems={data.packing ?? data.packingList}
      />
    </View>
  );
}
