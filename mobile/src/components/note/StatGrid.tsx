import { View, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import type { NoteAccent } from "@/lib/note-meta";

// One at-a-glance fact (recipe time, venue rating, …). Port of
// frontend/src/components/note/StatGrid.tsx. `icon` is optional so the same grid renders
// icon-less `data.facts[]` bands (label + value only).
export interface Stat {
  icon?: LucideIcon;
  label: string;
  value: string;
}

// The shared stat row: soft accent-tinted card, centered icon / label / value cells. Web used
// CSS grid columns; RN gets flex-wrap — up to three stats sit in one equal row, four-plus wrap
// to two columns so serif values never get crushed on a phone. `iconColor` is the raw accent
// colour for the (className-less) lucide icons.
export function StatGrid({
  stats,
  accent,
  iconColor,
  capitalize = false,
}: {
  stats: Stat[];
  accent: NoteAccent;
  iconColor?: string;
  capitalize?: boolean;
}) {
  if (stats.length === 0) return null;

  // A lone stat stretched across the note reads as broken — render it as a compact inline pill.
  if (stats.length === 1) {
    const s = stats[0];
    return (
      <View className="flex-row">
        <View
          className={`flex-row items-center gap-2 rounded-full border border-border px-3.5 py-1.5 ${accent.soft}`}
        >
          {s.icon && <s.icon size={16} color={iconColor} />}
          <Text className="text-[11px] uppercase tracking-wide text-ink-soft">{s.label}</Text>
          <Text className={`font-serif text-base text-ink ${capitalize ? "capitalize" : ""}`}>
            {s.value}
          </Text>
        </View>
      </View>
    );
  }

  // 1–3 stats → equal single row; 4+ → two-per-row wrap.
  const cellClass = stats.length <= 3 ? "flex-1" : "";
  return (
    <View className={`flex-row flex-wrap gap-3 rounded-2xl border border-border p-4 ${accent.soft}`}>
      {stats.map((s, i) => (
        <View
          key={i}
          className={`items-center gap-1 ${cellClass}`}
          style={cellClass ? undefined : { width: "46%" }}
        >
          {s.icon && <s.icon size={16} color={iconColor} />}
          <Text className="text-center text-[11px] uppercase tracking-wide text-ink-soft">
            {s.label}
          </Text>
          <Text
            className={`text-center font-serif text-base leading-tight text-ink ${capitalize ? "capitalize" : ""}`}
          >
            {s.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
