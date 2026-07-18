import "@/global.css";

import { cloneElement, useEffect, type ReactElement } from "react";
import { Text, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} from "@expo-google-fonts/instrument-serif";

import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { CategoryMetaProvider } from "@/contexts/category-meta";
import { ThemeProvider } from "@/theme/ThemeProvider";

// Web sets `font-family: var(--font-sans)` on <body>, so every text node defaults to Inter. RN has
// no cascade from View -> Text, and RN 0.86's Text is a React-19 forwardRef (no defaultProps), so
// there is no NativeWind API to set a global default. We inject Inter_400Regular as the *base* of
// every Text's style array (via the forwardRef `render`) — it sits first so any explicit style,
// including NativeWind's `font-*` classes, overrides it. This reaches every `<Text>` in the app,
// including screens owned by other agents, without editing a single call site. Guarded so it runs
// once. If a future RN version drops the forwardRef shape it degrades to no default font (no crash).
type StyledElement = ReactElement<{ style?: unknown }>;
const TextWithDefaults = Text as unknown as {
  render?: (...args: unknown[]) => StyledElement | null;
  __interDefaultFont?: boolean;
};
if (!TextWithDefaults.__interDefaultFont && typeof TextWithDefaults.render === "function") {
  TextWithDefaults.__interDefaultFont = true;
  const baseRender = TextWithDefaults.render;
  TextWithDefaults.render = function patchedTextRender(...args: unknown[]) {
    const element = baseRender.apply(this, args);
    if (!element) return element;
    return cloneElement(element, {
      style: [{ fontFamily: "Inter_400Regular" }, element.props.style],
    });
  };
}

// Auth gate. An effect-based redirect (rather than <Stack.Protected>) is used deliberately:
// other routes are authored concurrently by another agent, so enumerating every protected
// screen would be fragile — this guards the whole tree by segment regardless of route count.
function RootNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return; // wait for the first onAuthStateChanged before deciding
    const onSignIn = segments[0] === "sign-in";
    if (!user && !onSignIn) router.replace("/sign-in");
    else if (user && onSignIn) router.replace("/");
  }, [user, loading, segments, router]);

  // Nothing until auth resolves — avoids a flash of the feed or the sign-in screen.
  if (loading) return <View className="flex-1 bg-paper" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  // Brand fonts (Inter body + Instrument Serif display), loaded at runtime via expo-font. Hold the
  // tree behind the same bg-paper placeholder the auth gate uses so nothing renders in the system
  // font first (a visible reflow). expo-font is an already-linked SDK module and these are runtime
  // .ttf loads, so no native rebuild is required.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  if (!fontsLoaded && !fontError) return <View className="flex-1 bg-paper" />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <CategoryMetaProvider>
            <RootNavigator />
            <StatusBar style="auto" />
          </CategoryMetaProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
