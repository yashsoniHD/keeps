import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { CaptureModal } from "@/components/CaptureModal";

// PWA share-sheet target (manifest.json share_target). Platforms are inconsistent about
// which field carries the link: Android often puts it in `text`, iOS in `url`.
interface ShareSearch {
  url?: string;
  text?: string;
  title?: string;
}

export const Route = createFileRoute("/share")({
  validateSearch: (search: Record<string, unknown>): ShareSearch => ({
    url: typeof search.url === "string" ? search.url : undefined,
    text: typeof search.text === "string" ? search.text : undefined,
    title: typeof search.title === "string" ? search.title : undefined,
  }),
  component: SharePage,
});

function extractUrl({ url, text, title }: ShareSearch): string | null {
  for (const candidate of [url, text, title]) {
    const m = candidate?.match(/https?:\/\/\S+/);
    if (m) return m[0];
  }
  return null;
}

function SharePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [sharedUrl] = useState(() => extractUrl(search));

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!sharedUrl && user) navigate({ to: "/" });
  }, [sharedUrl, user, navigate]);

  if (loading || !user || !sharedUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <CaptureModal url={sharedUrl} onClose={() => navigate({ to: "/" })} />
    </div>
  );
}
