import { View, Text } from "react-native";
import type { NoteAccent } from "@/lib/note-meta";
import { StatGrid } from "./StatGrid";

// A note's at-a-glance `facts[]` block (label/value pairs). Port of
// frontend/src/components/note/FactsBlock.tsx — chooses between two layouts by shape:
//   - 2–6 facts with short values → a centered StatGrid band (reads as an infographic row);
//   - anything else → a definition-list card that wraps gracefully.
export interface Fact {
  label: string;
  value: string;
}

function fitsStatGrid(facts: Fact[]): boolean {
  return (
    facts.length >= 2 && facts.length <= 6 && facts.every((f) => String(f.value ?? "").length <= 28)
  );
}

export function FactsBlock({ facts, accent }: { facts?: Fact[]; accent: NoteAccent }) {
  if (!facts || facts.length === 0) return null;

  if (fitsStatGrid(facts)) {
    return <StatGrid stats={facts.map((f) => ({ label: f.label, value: f.value }))} accent={accent} />;
  }

  return (
    <View className={`rounded-2xl border border-border p-5 ${accent.soft}`}>
      {facts.map((f, i) => (
        <View
          key={i}
          className={`flex-row items-baseline justify-between gap-4 py-2.5 ${i > 0 ? "border-t border-border/60" : ""}`}
        >
          <Text className="text-sm text-ink-soft">{f.label}</Text>
          <Text className="flex-1 text-right text-sm font-medium text-ink">{f.value}</Text>
        </View>
      ))}
    </View>
  );
}
