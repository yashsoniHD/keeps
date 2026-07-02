import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clapperboard } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { MiniAppHeader } from "@/components/mini-apps/MiniAppHeader";
import { WatchlistView } from "@/components/watchlist/WatchlistView";

export const Route = createFileRoute("/watchlist/")({ component: Watchlist });

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
      <MiniAppHeader
        icon={<Clapperboard className="h-4.5 w-4.5" />}
        iconClass="bg-media-soft text-media"
        title="Watchlist"
        subtitle="Movies & shows you’re tracking"
      />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <WatchlistView uid={user.uid} />
        {/* No JustWatch credit here — this wall shows no "where to watch" data. The mandatory
            attribution lives in MovieDetail, gated behind the provider list that actually renders. */}
      </main>
    </AppShell>
  );
}
