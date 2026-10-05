import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { ingest, ingestText } from "@/lib/api";
import { enqueueCapture, isQueueableError } from "@/lib/capture-queue";
import { useCapture } from "@/components/CaptureProvider";
import { Icon, Logo } from "@/keeps/ui";

// PWA share-sheet target (manifest.json share_target, POST). The service worker
// catches the POST, stashes the payload in the Cache, and redirects here with ?shared=<id>.
// Legacy GET shares (url/text/title in the query) are still honored for older installs.
interface ShareSearch {
  shared?: string; // SW stash id (POST shares)
  url?: string;
  text?: string;
  title?: string;
}

interface SharedMeta {
  url: string;
  text: string;
  title: string;
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

function SharePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { refreshQueue } = useCapture();
  const fired = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Carry the share payload through login so the capture still fires after sign-in. The
    // payload lives in the Cache keyed by ?shared, so it survives the round-trip.
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
        let dupNoteId: string | undefined;
        const ingestLink = async (link: string) => {
          const r = await ingest(link);
          if (r.status === "completed") dupNoteId = r.note_id; // exact duplicate: no new job
        };
        if (search.shared) {
          const meta = await loadShared(search.shared);
          const link = urlFrom(meta?.url, meta?.text, meta?.title);
          if (link) await ingestLink(link);
          else if (meta?.text?.trim()) await ingestText(meta.text.trim(), meta.title || undefined);
        } else {
          // Legacy GET share (url/text/title in the query).
          const link = urlFrom(search.url, search.text, search.title);
          if (link) await ingestLink(link);
          else if (search.text?.trim())
            await ingestText(search.text.trim(), search.title || undefined);
        }
        if (dupNoteId) navigate({ to: "/notes/$noteId", params: { noteId: dupNoteId } });
        else navigate({ to: "/" }); // → the Notes feed, where the processing card gives feedback
      } catch (e) {
        // A link share that couldn't reach the backend is parked in the replay queue; a
        // file/text share can't be replayed, so surface it and stay on this screen.
        const link = urlFrom(search.url, search.text, search.title);
        if (link && isQueueableError(e)) {
          enqueueCapture(link);
          refreshQueue();
          navigate({ to: "/" });
        } else {
          setError(e instanceof Error ? e.message : "Couldn't save that. Please try again.");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, search.shared]);

  return (
    <main className="center-screen" aria-live="polite">
      <Logo />
      {error ? (
        <>
          <p className="login-error" role="alert">
            {error}
          </p>
          <a href="/" className="secondary">
            Back to your library
          </a>
        </>
      ) : (
        <p>
          <Icon name="Loader2" size={18} className="animate-spin" /> Saving to Keeps…
        </p>
      )}
    </main>
  );
}
