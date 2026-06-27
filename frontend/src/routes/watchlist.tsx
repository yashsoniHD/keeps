import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { WatchlistView } from "@/components/watchlist/WatchlistView";

export const Route = createFileRoute("/watchlist")({ component: Watchlist });

function Watchlist() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Clapperboard className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <Link
          to="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Notes
        </Link>
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-media-soft text-media">
            <Clapperboard className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-serif text-3xl text-ink">Watchlist</h1>
            <p className="text-sm text-ink-soft">Movies &amp; shows from your saved notes</p>
          </div>
        </div>

        <WatchlistView uid={user.uid} />

        {/* JustWatch attribution is mandatory wherever "where to watch" data is shown. */}
        <p className="mt-12 text-center text-xs text-ink-soft/70">Streaming data by JustWatch</p>
      </div>
    </AppShell>
  );
}
