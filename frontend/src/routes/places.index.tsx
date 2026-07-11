import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { MiniAppHeader } from "@/components/mini-apps/MiniAppHeader";
import { toolByKey } from "@/lib/collections-meta";
import { PlacesView } from "@/components/places/PlacesView";

export const Route = createFileRoute("/places/")({ component: Places });

function Places() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <MapPin className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <MiniAppHeader tool={toolByKey("places")} subtitle="Restaurants, cafés & bars to try" />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <PlacesView uid={user.uid} />
      </main>
    </AppShell>
  );
}
