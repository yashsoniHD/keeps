import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ingest } from "@/lib/api";
import { enqueueCapture, isQueueableError } from "@/lib/capture-queue";

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
  const fired = useRef(false);

  useEffect(() => {
    // Carry the share payload through login so the capture still fires after sign-in.
    if (!loading && !user) {
      navigate({
        to: "/login",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
    }
  }, [user, loading, navigate]);

  // Kick off the capture, then drop the user into the feed where the processing card
  // (driven by the new job doc) provides the feedback — no separate blocking screen.
  // A share that can't reach the backend (offline, 5xx) is parked in the capture queue
  // instead of vanishing; the feed shows it as "waiting" and replays it when online.
  useEffect(() => {
    if (!user || fired.current) return;
    if (!sharedUrl) {
      navigate({ to: "/" });
      return;
    }
    fired.current = true;
    ingest(sharedUrl)
      .catch((e) => {
        if (isQueueableError(e)) enqueueCapture(sharedUrl);
      })
      .finally(() => navigate({ to: "/" }));
  }, [user, sharedUrl, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
    </div>
  );
}
