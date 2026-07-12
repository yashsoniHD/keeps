// Shared sticky header for the five mini-app walls. Each app announces its identity on entry:
// the header band wears the tool's domain wash and the icon chip its saturated fill, so walking
// into Recipes *feels* terracotta and Trips sky — while back/search/settings stay in the same
// place on every wall. Identity comes straight from TOOLS (collections-meta) so it can't drift.
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Search, Settings } from "lucide-react";
import type { ToolMeta } from "@/lib/collections-meta";
import { FOCUS_RING } from "@/lib/ui";

const ICON_BTN_BASE = `h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`;
const ICON_BTN = `inline-flex ${ICON_BTN_BASE}`;

export function MiniAppHeader({
  tool,
  title,
  subtitle,
}: {
  tool: ToolMeta;
  title?: string; // defaults to the tool's label
  subtitle: string;
}) {
  const Icon = tool.icon;
  return (
    <header className={`sticky top-0 z-30 border-b pt-[env(safe-area-inset-top)] ${tool.wash}`}>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 md:gap-3 md:px-8">
        <Link to="/collections" aria-label="Back to Collections" title="Collections" className={ICON_BTN}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm ${tool.fill}`}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-2xl leading-tight text-ink">
            {title ?? tool.label}
          </h1>
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
