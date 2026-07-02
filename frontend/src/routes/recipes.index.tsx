import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChefHat } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { MiniAppHeader } from "@/components/mini-apps/MiniAppHeader";
import { RecipesView } from "@/components/recipes/RecipesView";

export const Route = createFileRoute("/recipes/")({ component: Recipes });

function Recipes() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ChefHat className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <MiniAppHeader
        icon={<ChefHat className="h-4.5 w-4.5" />}
        iconClass="bg-recipe-soft text-recipe"
        title="Recipes"
        subtitle="Your cookbook of saved dishes"
      />
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <RecipesView uid={user.uid} />
      </main>
    </AppShell>
  );
}
