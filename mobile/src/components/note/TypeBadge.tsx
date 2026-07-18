import { View, Text } from "react-native";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import { Glyph } from "./Glyph";
import { useAccentColors } from "./colors";

// Port of frontend/src/components/note/TypeBadge.tsx — the accent-tinted category chip. The chip
// className carries both a bg (applies to the View) and a text colour (applies to the Text); the
// lucide icon takes the raw chip colour.
export function TypeBadge({ type, size = "sm" }: { type: string; size?: "sm" | "md" }) {
  const accent = noteAccent(type);
  const { chip } = useAccentColors(type);
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full ${accent.chip} ${
        size === "md" ? "px-3 py-1" : "px-2 py-0.5"
      }`}
    >
      <Glyph icon={noteIcon(type)} size={size === "md" ? 14 : 12} color={chip} />
      <Text
        className={`font-medium ${accent.chip} ${size === "md" ? "text-sm" : "text-xs"}`}
      >
        {noteLabel(type)}
      </Text>
    </View>
  );
}
