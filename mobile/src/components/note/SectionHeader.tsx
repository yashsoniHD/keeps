import { View, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";

// Shared section heading for note templates: an optional accent-tinted lucide icon beside a
// serif h2. Port of frontend/src/components/note/SectionHeader.tsx — the web `iconClassName`
// (accent.text) becomes an explicit `iconColor` because lucide-react-native takes a colour prop.
export function SectionHeader({
  icon: Icon,
  iconColor,
  children,
}: {
  icon?: LucideIcon;
  iconColor?: string;
  children: string;
}) {
  return (
    <View className="flex-row items-center gap-2">
      {Icon && <Icon size={20} color={iconColor} />}
      <Text className="font-serif text-xl text-ink">{children}</Text>
    </View>
  );
}
