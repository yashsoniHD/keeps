import { Pressable, View } from "react-native";
import { CATEGORY_ICONS, PALETTE_DOTS } from "@/lib/note-meta";

// The icon + colour picker shared by the New and Edit collection sheets — the same picker
// vocabulary as the web "Manage categories" flow (CATEGORY_ICONS grid + PALETTE_DOTS swatches).
// Icons in CATEGORY_ICONS are already interop-registered, so their className `text-*` colours
// reach the SVG. Selected state uses a border (RN has no `ring`).
export function IconPalettePicker({
  icon,
  palette,
  onIcon,
  onPalette,
}: {
  icon: string | null;
  palette: number | null;
  onIcon: (name: string) => void;
  onPalette: (index: number) => void;
}) {
  return (
    <View className="rounded-2xl border border-border bg-paper p-3">
      <View className="flex-row flex-wrap gap-1">
        {Object.entries(CATEGORY_ICONS).map(([name, Icon]) => {
          const active = icon === name;
          return (
            <Pressable
              key={name}
              onPress={() => onIcon(name)}
              accessibilityLabel={name}
              accessibilityState={{ selected: active }}
              className={`h-9 w-9 items-center justify-center rounded-lg ${active ? "bg-ink" : ""}`}
            >
              <Icon size={16} className={active ? "text-paper" : "text-ink-soft"} />
            </Pressable>
          );
        })}
      </View>
      <View className="mt-3 flex-row flex-wrap gap-2 border-t border-border pt-3">
        {PALETTE_DOTS.map((dot, i) => (
          <Pressable
            key={i}
            onPress={() => onPalette(i)}
            accessibilityLabel={`Colour ${i + 1}`}
            accessibilityState={{ selected: palette === i }}
            className={`h-7 w-7 rounded-full ${dot} ${palette === i ? "border-2 border-ink" : ""}`}
          />
        ))}
      </View>
    </View>
  );
}
