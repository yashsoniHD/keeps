import type { ColorValue } from "react-native";
import { Tabs } from "expo-router/js-tabs";
import { Home, LibraryBig, Settings, Sparkles } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";

// Bottom tab bar. A stock react-navigation tab bar (no custom tab bar for v1) styled with the
// design tokens: active tint = ink, inactive = ink-soft, bar surface = card over a border
// hairline. Colours are resolved from the token table (the bar takes real colour values, not
// NativeWind classNames) and flip with the theme.
function icon(Glyph: LucideIcon) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Glyph color={color as string} size={size} />
  );
}

export default function TabsLayout() {
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.ink,
        tabBarInactiveTintColor: t["ink-soft"],
        tabBarStyle: {
          backgroundColor: t.card,
          borderTopColor: t.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: icon(Home) }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: "Library", tabBarIcon: icon(LibraryBig) }}
      />
      <Tabs.Screen
        name="ask"
        options={{ title: "Ask", tabBarIcon: icon(Sparkles) }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: icon(Settings) }}
      />
    </Tabs>
  );
}
