import { Link, useRouterState } from "@tanstack/react-router";
import { House, LayoutGrid, Plus, Sparkles, Settings, type LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { useCapture } from "@/components/CaptureProvider";
import { FOCUS_RING, PRESS } from "@/lib/ui";

// Mobile-only bottom tab bar. Hidden on the chromeless surfaces (sign-in + public viewer) and
// when signed out — same visibility rule AskFab uses. Desktop keeps the per-screen header nav
// (this whole bar is `md:hidden`).
const HIDDEN_PREFIXES = ["/login", "/share", "/p/"];

// The mini-app walls all live under the Collections slot (they're facets of the same library).
const COLLECTIONS_PREFIXES = ["/collections", "/watchlist", "/places", "/library"];

const itemBase = `flex flex-1 flex-col items-center justify-center gap-1 ${PRESS} ${FOCUS_RING}`;

// Shared icon + label + active-dot stack.
function TabInner({
  icon: Icon,
  label,
  active,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
}) {
  return (
    <>
      <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden />
      <span className="text-xs font-medium leading-none">{label}</span>
      <span className={`h-1 w-1 rounded-full ${active ? "bg-current" : "bg-transparent"}`} />
    </>
  );
}

export function BottomNav() {
  const { user } = useAuth();
  const { openChat, isOpen } = useAsk();
  const { openCapture } = useCapture();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const hidden = !user || HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
  if (hidden) return null;

  const homeActive = pathname === "/";
  const collectionsActive = COLLECTIONS_PREFIXES.some((p) => pathname.startsWith(p));
  const settingsActive = pathname.startsWith("/settings");
  const askActive = isOpen;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-paper/95 backdrop-blur pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-stretch justify-around">
        <Link
          to="/"
          aria-label="Home"
          aria-current={homeActive ? "page" : undefined}
          className={`${itemBase} ${homeActive ? "text-ink" : "text-ink-soft"}`}
        >
          <TabInner icon={House} label="Home" active={homeActive} />
        </Link>

        <Link
          to="/collections"
          aria-label="Collections"
          aria-current={collectionsActive ? "page" : undefined}
          className={`${itemBase} ${collectionsActive ? "text-ink" : "text-ink-soft"}`}
        >
          <TabInner icon={LayoutGrid} label="Collections" active={collectionsActive} />
        </Link>

        {/* Inline center primary: capture a new note (replaces the FAB on mobile). */}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={openCapture}
            aria-label="New note"
            className={`flex h-11 w-11 items-center justify-center rounded-full bg-ink text-paper ${PRESS} ${FOCUS_RING}`}
          >
            <Plus className="h-6 w-6" aria-hidden />
          </button>
        </div>

        <button
          type="button"
          onClick={() => openChat()}
          aria-label="Ask"
          className={`${itemBase} ${askActive ? "text-ink" : "text-ink-soft"}`}
        >
          <TabInner icon={Sparkles} label="Ask" active={askActive} />
        </button>

        <Link
          to="/settings"
          aria-label="Settings"
          aria-current={settingsActive ? "page" : undefined}
          className={`${itemBase} ${settingsActive ? "text-ink" : "text-ink-soft"}`}
        >
          <TabInner icon={Settings} label="Settings" active={settingsActive} />
        </Link>
      </div>
    </nav>
  );
}
