import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DetailError } from "@/components/DetailError";
import { ProductDetail } from "@/components/wishlist/ProductDetail";

export const Route = createFileRoute("/wishlist/$itemId")({ component: WishlistItem });

function WishlistItem() {
  const { itemId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: `/wishlist/${itemId}` } });
    }
  }, [user, loading, navigate, itemId]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ShoppingBag className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
        <Link
          to="/wishlist"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Wishlist
        </Link>
        <ErrorBoundary label="wishlist-detail" fallback={<DetailError />}>
          <ProductDetail
            uid={user.uid}
            itemId={itemId}
            onDeleted={() => navigate({ to: "/wishlist" })}
          />
        </ErrorBoundary>
      </div>
    </AppShell>
  );
}
