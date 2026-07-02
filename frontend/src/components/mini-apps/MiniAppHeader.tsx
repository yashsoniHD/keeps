// Shared sticky header for the five mini-app walls. Mirrors the Notes feed header (back to
// Library + serif collection name + icon actions, sticky with backdrop blur) so every
// collection screen reads the same — and Search/Settings stop being reachable only from Home.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Search, Settings } from "lucide-react";
import { FOCUS_RING } from "@/lib/ui";

const ICON_BTN_BASE = `h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`;
const ICON_BTN = `inline-flex ${ICON_BTN_BASE}`;

export function MiniAppHeader({
  icon,
  iconClass,
  title,
  subtitle,
}: {
  icon: ReactNode;
  iconClass: string; // soft accent chip classes, e.g. "bg-media-soft text-media" (full literals)
  title: string;
  subtitle: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 md:gap-3 md:px-8">
        <Link to="/" aria-label="Back to Library" title="Library" className={ICON_BTN}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconClass}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-2xl leading-tight text-ink">{title}</h1>
          <p className="hidden truncate text-xs text-ink-soft sm:block">{subtitle}</p>
        </div>
        <Link to="/search" aria-label="Search" title="Search" className={ICON_BTN}>
          <Search className="h-4 w-4" />
        </Link>
        <Link
          to="/settings"
          aria-label="Settings"
          title="Settings"
          className={`hidden md:inline-flex ${ICON_BTN_BASE}`}
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}
