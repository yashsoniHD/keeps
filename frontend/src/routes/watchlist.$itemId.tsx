import { useEffect } from "react";
import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DetailError } from "@/components/DetailError";
import { MovieDetail } from "@/components/watchlist/MovieDetail";

export const Route = createFileRoute("/watchlist/$itemId")({ component: WatchlistItem });

function WatchlistItem() {
  const { itemId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // Back returns to wherever the item was opened from (a note, the wall, search). Falls back
  // to the Watchlist wall when opened cold, e.g. a deep link.
  const goBack = () => {
    if (canGoBack) router.history.back();
    else navigate({ to: "/watchlist" });
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: `/watchlist/${itemId}` } });
    }
  }, [user, loading, navigate, itemId]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Clapperboard className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back to Watchlist"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Watchlist
        </button>
        <ErrorBoundary label="watchlist-detail" fallback={<DetailError />}>
          <MovieDetail
            uid={user.uid}
            itemId={itemId}
            onDeleted={() => navigate({ to: "/watchlist" })}
          />
        </ErrorBoundary>
      </div>
    </AppShell>
  );
}
