import type { ReactNode } from "react";

// Single-screen app: navigation lives in the page headers (gear → settings,
// back links) — no bottom tab bar on any size.
export function AppShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
