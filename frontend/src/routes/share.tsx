import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ingest, ingestMedia, ingestText } from "@/lib/api";
import { enqueueCapture, isQueueableError } from "@/lib/capture-queue";

// PWA share-sheet target (manifest.json share_target, POST multipart). The service worker
// catches the POST, stashes the payload in the Cache, and redirects here with ?shared=<id>.
// Legacy GET shares (url/text/title in the query) are still honored for older installs.
interface ShareSearch {
  shared?: string; // SW stash id (POST shares: files and/or text)
  url?: string;
  text?: string;
  title?: string;
}

interface SharedMeta {
  url: string;
  text: string;
  title: string;
  files: { key: string; type: string; name: string }[];
}

export const Route = createFileRoute("/share")({
  validateSearch: (search: Record<string, unknown>): ShareSearch => ({
    shared: typeof search.shared === "string" ? search.shared : undefined,
    url: typeof search.url === "string" ? search.url : undefined,
    text: typeof search.text === "string" ? search.text : undefined,
    title: typeof search.title === "string" ? search.title : undefined,
  }),
  component: SharePage,
});

function urlFrom(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    const m = c?.match(/https?:\/\/\S+/);
    if (m) return m[0];
  }
  return null;
}

// Read the SW-stashed payload back out of the Cache (via the SW's /__shared/ handler).
async function loadShared(id: string): Promise<SharedMeta | null> {
  try {
    const res = await fetch(`/__shared/${id}/meta`);
    if (!res.ok) return null;
    return (await res.json()) as SharedMeta;
  } catch {
    return null;
  }
}

async function fileFromCache(key: string, type: string, name: string): Promise<File | null> {
  try {
    const res = await fetch(key);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], name || "shared", { type: type || blob.type });
  } catch {
    return null;
  }
}

function kindOf(type: string): "image" | "pdf" | null {
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  return null;
}

function SharePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const fired = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Carry the share payload through login so the capture still fires after sign-in. The
    // files live in the Cache keyed by ?shared, so they survive the round-trip.
    if (!loading && !user) {
      navigate({
        to: "/login",
        search: { redirect: `${window.location.pathname}${window.location.search}` },
      });
    }
  }, [user, loading, navigate]);

  // Kick off the capture(s), then drop the user into the feed where the processing card
  // (driven by the new job doc) provides the feedback — no separate blocking screen.
  useEffect(() => {
    if (!user || fired.current) return;
    fired.current = true;

    (async () => {
      try {
        if (search.shared) {
          const meta = await loadShared(search.shared);
          if (meta?.files?.length) {
            // One job per shared file (usually exactly one).
            for (const f of meta.files) {
              const kind = kindOf(f.type);
              if (!kind) continue;
              const file = await fileFromCache(f.key, f.type, f.name);
              if (file) await ingestMedia(file, kind, file.name);
            }
          } else {
            // No files → fall back to the shared link/text the SW also stashed.
            const link = urlFrom(meta?.url, meta?.text, meta?.title);
            if (link) await ingest(link);
            else if (meta?.text?.trim())
              await ingestText(meta.text.trim(), meta.title || undefined);
          }
        } else {
          // Legacy GET share (url/text/title in the query).
          const link = urlFrom(search.url, search.text, search.title);
          if (link) await ingest(link);
          else if (search.text?.trim())
            await ingestText(search.text.trim(), search.title || undefined);
        }
        navigate({ to: "/" }); // → the Notes feed, where the processing card gives feedback
      } catch (e) {
        // A link share that couldn't reach the backend is parked in the replay queue; a
        // file/text share can't be replayed, so surface it and stay on this screen.
        const link = urlFrom(search.url, search.text, search.title);
        if (link && isQueueableError(e)) {
          enqueueCapture(link);
          navigate({ to: "/" });
        } else {
          setError(e instanceof Error ? e.message : "Couldn't save that. Please try again.");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, search.shared]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
      {error && <p className="max-w-xs text-sm text-destructive">{error}</p>}
    </div>
  );
}
