import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clapperboard, Sparkles, type LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { FOCUS_RING } from "@/lib/ui";

// The Library is a home for purpose-built collections over the user's saved notes. Watchlist
// (movies & shows) is the first segment; more (recipes, travel, …) will slot in beside it.
interface Segment {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  to: string;
  // tailwind accent classes (soft bg + text) for the icon chip
  chip: string;
}

const SEGMENTS: Segment[] = [
  {
    id: "watchlist",
    label: "Watchlist",
    description: "Movies & shows from your saved notes — track what to watch and where.",
    icon: Clapperboard,
    to: "/watchlist",
    chip: "bg-media-soft text-media",
  },
];

function Library() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Notes
        </Link>
        <h1 className="font-serif text-3xl text-ink">Library</h1>
        <p className="mt-1 text-sm text-ink-soft">Purpose-built collections from your saved notes</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {SEGMENTS.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.id}
                to={s.to}
                className={`group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg ${FOCUS_RING}`}
              >
                <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${s.chip}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{s.label}</span>
                  <span className="mt-0.5 block text-sm text-ink-soft">{s.description}</span>
                </span>
              </Link>
            );
          })}

          {/* Forward-looking: more segments (recipes, travel, …) land here. */}
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-5 text-center text-sm text-ink-soft/70">
            More collections coming soon
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/library")({ component: Library });
