import { Pressable, Text, View } from "react-native";

export type CaptureMode = "link" | "text" | "photo" | "file" | "voice";

const MODES: { key: CaptureMode; label: string }[] = [
  { key: "link", label: "Link" },
  { key: "text", label: "Text" },
  { key: "photo", label: "Photo" },
  { key: "file", label: "File" },
  { key: "voice", label: "Voice" },
];

// Segmented Link / Text / Photo / File / Voice switch at the top of the capture sheet. Purely
// presentational — the screen owns the active mode and its inputs/pickers.
export function ModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: CaptureMode;
  onChange: (m: CaptureMode) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row rounded-full border border-border bg-muted p-1">
      {MODES.map(({ key, label }) => {
        const active = mode === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(key)}
            className={`flex-1 items-center rounded-full py-2 ${active ? "bg-card" : ""}`}
          >
            <Text className={`text-xs font-medium ${active ? "text-ink" : "text-ink-soft"}`}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
