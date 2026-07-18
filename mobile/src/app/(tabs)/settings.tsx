import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { ChevronRight, LogOut, Monitor, Moon, Sparkles, Sun } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta).
[ChevronRight, LogOut, Monitor, Moon, Sparkles, Sun].forEach(interopIcon);
import type { LucideIcon } from "lucide-react-native";

import { useAuth } from "@/contexts/auth-context";
import { useTheme, type Theme } from "@/theme/ThemeProvider";
import { ConnectedDevices } from "@/components/settings/ConnectedDevices";
import { RegionSection } from "@/components/settings/RegionSection";
import { CategoriesSection } from "@/components/settings/CategoriesSection";
import { ShareApp } from "@/components/settings/ShareApp";
import { DeleteAccount } from "@/components/settings/DeleteAccount";

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView edges={["top"]}>
        <View className="px-5 pb-3 pt-2">
          <Text className="text-2xl font-semibold text-ink">Settings</Text>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerClassName="px-5 pb-10">
        {/* Profile */}
        <View className="flex-row items-center gap-4 rounded-2xl border border-border bg-card p-4">
          {user?.photoURL ? (
            <Image
              source={{ uri: user.photoURL }}
              style={{ width: 56, height: 56, borderRadius: 28 }}
            />
          ) : (
            <View className="h-14 w-14 items-center justify-center rounded-full bg-ink">
              <Text className="text-xl font-semibold text-paper">
                {(user?.displayName || user?.email || "?").charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View className="min-w-0 flex-1">
            {user?.displayName ? (
              <Text className="text-base font-semibold text-ink" numberOfLines={1}>
                {user.displayName}
              </Text>
            ) : null}
            {user?.email ? (
              <Text className="text-sm text-ink-soft" numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Your digest — the marquee feature, sits right under the profile */}
        <Text className="mb-2 mt-6 px-1 text-xs uppercase tracking-wider text-ink-soft">
          Recap
        </Text>
        <Pressable
          onPress={() => router.push("/digest")}
          accessibilityRole="button"
          className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-4 active:opacity-80"
        >
          <View className="h-10 w-10 items-center justify-center rounded-full bg-summary-soft">
            <Sparkles size={18} className="text-summary-chip" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-medium text-ink">Your digest</Text>
            <Text className="text-sm text-ink-soft">A story recap of your latest saves.</Text>
          </View>
          <ChevronRight size={20} className="text-ink-soft" />
        </Pressable>

        {/* Region */}
        <RegionSection />

        {/* Categories */}
        <CategoriesSection />

        {/* Connected devices */}
        <ConnectedDevices />

        {/* Share the app */}
        <ShareApp />

        {/* Appearance */}
        <Text className="mb-2 mt-6 px-1 text-xs uppercase tracking-wider text-ink-soft">
          Appearance
        </Text>
        <View className="flex-row gap-2 rounded-2xl border border-border bg-card p-2">
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.value;
            const Icon = opt.icon;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setTheme(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2.5 ${
                  active ? "bg-ink" : "active:opacity-70"
                }`}
              >
                <Icon size={16} className={active ? "text-paper" : "text-ink-soft"} />
                <Text
                  className={`text-sm font-medium ${active ? "text-paper" : "text-ink-soft"}`}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Danger zone */}
        <DeleteAccount />

        {/* Sign out */}
        <Pressable
          onPress={signOut}
          accessibilityRole="button"
          className="mt-6 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 active:opacity-80"
        >
          <LogOut size={18} className="text-destructive" />
          <Text className="text-base font-medium text-destructive">Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
