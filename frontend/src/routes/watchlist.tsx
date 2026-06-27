import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clapperboard, DownloadCloud, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AppShell } from "@/components/AppShell";
import { WatchlistView } from "@/components/watchlist/WatchlistView";
import { backfillWatchItems } from "@/lib/api";
import { FOCUS_RING } from "@/lib/ui";

export const Route = createFileRoute("/watchlist")({ component: Watchlist });

function ImportButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await backfillWatchItems();
      setMsg(
        r.titles_found > 0
          ? `Imported ${r.titles_found} title${r.titles_found === 1 ? "" : "s"} from ${r.notes_processed} note${r.notes_processed === 1 ? "" : "s"}.`
          : "No movies or shows found in your notes yet.",
      );
    } catch {
      setMsg("Import failed — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-media-soft disabled:opacity-60 ${FOCUS_RING}`}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
        {busy ? "Importing…" : "Import from notes"}
      </button>
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}

function Watchlist() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Clapperboard className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <Link
          to="/library"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Library
        </Link>
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-media-soft text-media">
              <Clapperboard className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-serif text-3xl text-ink">Watchlist</h1>
              <p className="text-sm text-ink-soft">Movies &amp; shows from your saved notes</p>
            </div>
          </div>
          <ImportButton />
        </div>

        <WatchlistView uid={user.uid} />

        {/* JustWatch attribution is mandatory wherever "where to watch" data is shown. */}
        <p className="mt-12 text-center text-xs text-ink-soft/70">Streaming data by JustWatch</p>
      </div>
    </AppShell>
  );
}
