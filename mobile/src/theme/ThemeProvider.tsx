import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { colorScheme as nativewindColorScheme, useColorScheme } from "nativewind";
import { createMMKV } from "react-native-mmkv";

// Light/dark theming, ported from the web app (frontend/src/lib/theme.tsx). The user's
// choice ("light" | "dark" | "system") is persisted in MMKV; "system" follows the OS.
// NativeWind's `colorScheme` drives the `dark` class that flips the CSS-variable tokens
// (see src/global.css); `useColorScheme` reports the resolved scheme (and tracks the OS
// while in "system").
export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const STORAGE_KEY = "clipnote-theme";
const storage = createMMKV({ id: "clipnote" });

function readStored(): Theme {
  const v = storage.getString(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

interface ThemeContextValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  // Resolved scheme from NativeWind — reflects the OS while `theme` is "system".
  const { colorScheme } = useColorScheme();

  // Apply the stored/selected preference to NativeWind on mount and on every change.
  useEffect(() => {
    nativewindColorScheme.set(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    storage.set(STORAGE_KEY, t);
    nativewindColorScheme.set(t);
  }, []);

  const resolved: Resolved = colorScheme === "dark" ? "dark" : "light";

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
