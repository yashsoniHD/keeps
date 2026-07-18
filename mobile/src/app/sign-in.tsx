import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as AppleAuthentication from "expo-apple-authentication";

import { ClipMark } from "@/components/brand/ClipMark";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";

// The native Apple button is only available on iOS 13+. We resolve availability synchronously
// from the platform check the component itself performs (it renders null when unavailable), so
// we always mount it and let it hide itself — no extra async availability state to manage.
export default function SignInScreen() {
  const { signInWithGoogle, signInWithApple } = useAuth();
  const { resolved } = useTheme();
  const tokens = resolved === "dark" ? dark : light;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      console.error("[auth] sign-in failed:", code ?? err);
      setError(`Sign-in didn't complete${code ? ` (${code})` : ""}. Please try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1">
        <View className="flex-1 items-center justify-center px-6">
          <View className="w-full max-w-sm items-center">
            <View className="mb-6 h-16 w-16 items-center justify-center rounded-2xl bg-ink">
              <ClipMark size={40} color={tokens["brand-foreground"]} strokeWidth={3.2} />
            </View>
            <Text className="font-serif text-4xl text-ink">Clipnote</Text>
            <Text className="mt-3 max-w-xs text-center text-lg leading-snug text-ink-soft">
              Save anything. Come back to everything.
            </Text>

            <View className="mt-10 w-full gap-3">
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => run(signInWithGoogle)}
                className="h-14 w-full flex-row items-center justify-center gap-3 rounded-full bg-ink active:opacity-90 disabled:opacity-60"
              >
                {busy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-base font-medium text-paper">Continue with Google</Text>
                )}
              </Pressable>

              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  resolved === "dark"
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={999}
                style={{ height: 56, width: "100%" }}
                onPress={() => run(signInWithApple)}
              />
            </View>

            {error && <Text className="mt-4 text-center text-sm text-destructive">{error}</Text>}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}
