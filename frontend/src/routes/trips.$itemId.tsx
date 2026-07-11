import { useEffect } from "react";
import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Plane } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DetailError } from "@/components/DetailError";
import { TripDetail } from "@/components/trips/TripDetail";

export const Route = createFileRoute("/trips/$itemId")({ component: TripsItem });

function TripsItem() {
  const { itemId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // Back returns to wherever the item was opened from (a note, the wall, search). Falls back
  // to the Trips wall when opened cold, e.g. a deep link.
  const goBack = () => {
    if (canGoBack) router.history.back();
    else navigate({ to: "/trips" });
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: `/trips/${itemId}` } });
    }
  }, [user, loading, navigate, itemId]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Plane className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back to Trips"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Trips
        </button>
        <ErrorBoundary label="trips-detail" fallback={<DetailError />}>
          <TripDetail uid={user.uid} itemId={itemId} onDeleted={() => navigate({ to: "/trips" })} />
        </ErrorBoundary>
      </div>
    </AppShell>
  );
}
