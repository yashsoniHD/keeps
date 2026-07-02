import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { MiniAppHeader } from "@/components/mini-apps/MiniAppHeader";
import { toolByKey } from "@/lib/collections-meta";
import { WishlistView } from "@/components/wishlist/WishlistView";

export const Route = createFileRoute("/wishlist/")({ component: Wishlist });

function Wishlist() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ShoppingBag className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <MiniAppHeader tool={toolByKey("wishlist")} subtitle="Products you’re tracking" />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <WishlistView uid={user.uid} />
      </main>
    </AppShell>
  );
}
