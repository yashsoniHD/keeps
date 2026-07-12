import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// Light/dark theming. The `dark` class on <html> drives the CSS tokens (see styles.css);
// the first-paint class is set by an inline script in index.html to avoid a flash, and
// this provider keeps it in sync, persists the choice, and follows the OS in "system".
export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

const STORAGE_KEY = "clipnote-theme";
// Browser-chrome colors (status bar / address bar). These are the computed sRGB hex of the
// CSS `--paper` custom property (styles.css `:root`/`.dark`, defined in OKLCH) for each mode —
// keep in sync if those OKLCH values change. index.html's first-paint script and manifest.json
// must match these exactly so there's no theme-color flash across the light/dark boundary.
// light: oklch(0.98 0.012 80) -> #fdf8f0 · dark: oklch(0.14 0 0) -> #090909
const THEME_COLOR: Record<Resolved, string> = { light: "#fdf8f0", dark: "#090909" };

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage blocked — fall back to system */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : false;
}

function resolve(theme: Theme): Resolved {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

function apply(resolved: Resolved) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLOR[resolved]);
}

interface ThemeContextValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolved, setResolved] = useState<Resolved>(() => resolve(readStored()));

  // Apply + persist on every change.
  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    apply(r);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage blocked — the class is still applied for this session */
    }
  }, [theme]);

  // Track OS changes only while following the system.
  useEffect(() => {
    if (theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setResolved(r);
      apply(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
