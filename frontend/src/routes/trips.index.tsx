import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plane } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { MiniAppHeader } from "@/components/mini-apps/MiniAppHeader";
import { toolByKey } from "@/lib/collections-meta";
import { TripsView } from "@/components/trips/TripsView";

export const Route = createFileRoute("/trips/")({ component: Trips });

function Trips() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Plane className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <MiniAppHeader tool={toolByKey("trips")} subtitle="Your saved travel plans" />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <TripsView uid={user.uid} />
      </main>
    </AppShell>
  );
}
