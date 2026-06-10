import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Settings } from "lucide-react";
import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabs = [
    { to: "/", label: "Home", icon: Home, match: (p: string) => p === "/" || p.startsWith("/notes") },
    { to: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
  ] as const;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      {children}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden">
        <ul className="mx-auto flex max-w-3xl items-stretch justify-around">
          {tabs.map((t) => {
            const active = t.match(pathname);
            const Icon = t.icon;
            return (
              <li key={t.to} className="flex-1">
                <Link
                  to={t.to}
                  className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${
                    active ? "text-ink" : "text-ink-soft"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
