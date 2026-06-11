import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search, Sparkles, Plus, LayoutGrid, List, Globe, ChevronDown, Settings, AlertCircle, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { watchNotes, watchPendingJobs, getUserCategories } from "@/lib/firestore";
import { ingest } from "@/lib/api";
import { noteLabel, sourceLabel } from "@/lib/note-meta";
import { NoteCard, NoteRowList, ProcessingCard } from "@/components/NoteCard";
import { AppShell } from "@/components/AppShell";
import type { Note, Job } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Feed });

type Layout = "standard" | "condensed";

function Feed() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesReady, setNotesReady] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [max, setMax] = useState(50);
  const [userCategories, setUserCategories] = useState<string[]>([]);
  const [active, setActive] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<Layout>(
    () => (localStorage.getItem("clipnote.layout") as Layout) || "standard",
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [optimistic, setOptimistic] = useState<{ id: string; url: string }[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [pendingUrl, setPendingUrl] = useState("");
  const [ingestError, setIngestError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Real-time feed: new/updated notes stream in without a refetch. The active type
  // filter runs server-side (composite index), so it sees past the feed window.
  useEffect(() => {
    if (!user) return;
    return watchNotes(
      user.uid,
      (n) => {
        setNotes(n);
        setNotesReady(true);
        setFeedError(false);
      },
      {
        max,
        contentType: active === "all" ? undefined : active,
        onError: () => setFeedError(true),
      },
    );
  }, [user, max, active]);

  // Chip list comes from users/{uid}.categories (source of truth), so chips don't
  // vanish when a server-side filter narrows the loaded notes to one type.
  useEffect(() => {
    if (!user) return;
    getUserCategories(user.uid).then(setUserCategories).catch(() => {});
  }, [user]);

  // In-flight captures → optimistic "processing" cards (works for every capture path).
  useEffect(() => {
    if (!user) return;
    return watchPendingJobs(user.uid, setJobs);
  }, [user]);

  // Retire each local placeholder once its real job (same url) or finished note arrives,
  // so the optimistic card hands off seamlessly to the server-backed one.
  useEffect(() => {
    if (!optimistic.length) return;
    const realUrls = new Set(jobs.map((j) => j.url));
    const noteUrls = new Set(notes.map((n) => n.source_url));
    setOptimistic((prev) => prev.filter((o) => !realUrls.has(o.url) && !noteUrls.has(o.url)));
  }, [jobs, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fire-and-forget capture: the job doc (and thus the processing card) appears within a
  // few hundred ms; the local placeholder covers that gap so feedback is instant.
  const handleCapture = async (raw: string) => {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setShowAdd(false);
    setPendingUrl("");
    setIngestError(null);
    const tempId = `opt-${url}-${notes.length}`;
    setOptimistic((prev) => [{ id: tempId, url }, ...prev]);
    // Safety net: drop the placeholder if the listener never replaces it (e.g. the
    // backend rewrote the URL so it can't be matched). Longer than any real job.
    setTimeout(() => setOptimistic((prev) => prev.filter((o) => o.id !== tempId)), 120_000);
    try {
      await ingest(url);
    } catch (e) {
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      setIngestError(e instanceof Error ? e.message : "Couldn't start the capture. Please try again.");
    }
  };

  const toggleLayout = () => {
    const next: Layout = layout === "standard" ? "condensed" : "standard";
    setLayout(next);
    localStorage.setItem("clipnote.layout", next);
  };

  // Filter chips emerge from the user's own taxonomy (user doc + loaded notes).
  const categories = useMemo(
    () => Array.from(new Set([...userCategories, ...notes.map((n) => n.content_type)])).sort(),
    [notes, userCategories],
  );
  const sources = useMemo(
    () => Array.from(new Set(notes.map((n) => n.source_domain))).sort(),
    [notes],
  );

  const filtered = useMemo(() => {
    return notes.filter((n) => {
      if (active !== "all" && n.content_type !== active) return false;
      if (source !== "all" && n.source_domain !== source) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return n.title.toLowerCase().includes(q) || n.ai_summary.toLowerCase().includes(q);
      }
      return true;
    });
  }, [notes, active, source, query]);

  // Processing cards show only on the default view — an in-flight job has no type/title
  // yet to match a filter or search. Merge server jobs with not-yet-acknowledged local
  // placeholders, drop any whose note already landed (the brief completion overlap).
  const pendingJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all" || query.trim()) return [];
    const noteUrls = new Set(notes.map((n) => n.source_url));
    const jobUrls = new Set(jobs.map((j) => j.url));
    const placeholders = optimistic
      .filter((o) => !jobUrls.has(o.url) && !noteUrls.has(o.url))
      .map((o) => ({ id: o.id, url: o.url, status: "pending" }) as Job);
    return [...placeholders, ...jobs.filter((j) => !noteUrls.has(j.url))];
  }, [jobs, optimistic, notes, active, source, query]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 pt-4 pb-3 md:px-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink text-paper">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="font-serif text-2xl text-ink">Clipnote</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleLayout}
                aria-label={layout === "standard" ? "Switch to condensed layout" : "Switch to card layout"}
                title={layout === "standard" ? "Condensed view" : "Card view"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink"
              >
                {layout === "standard" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              </button>
              <Link
                to="/settings"
                aria-label="Settings"
                title="Settings"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink"
              >
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5">
              <Search className="h-4 w-4 text-ink-soft" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your notes"
                className="w-full bg-transparent text-base outline-none placeholder:text-ink-soft md:text-sm"
              />
            </label>

            {sources.length > 1 && (
              <label className="relative inline-flex shrink-0 items-center">
                <Globe className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-ink-soft" />
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  aria-label="Filter by source"
                  className="appearance-none rounded-full border border-border bg-card py-2.5 pl-9 pr-8 text-sm text-ink outline-none transition-colors hover:bg-accent"
                >
                  <option value="all">All sources</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {sourceLabel(s)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-ink-soft" />
              </label>
            )}
          </div>

          {categories.length > 0 && (
            <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {[{ id: "all", label: "All" }, ...categories.map((c) => ({ id: c, label: noteLabel(c) }))].map(
                (f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActive(f.id)}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                      active === f.id
                        ? "bg-ink text-paper"
                        : "border border-border bg-card text-ink-soft hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 md:px-8">
        {ingestError && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{ingestError}</span>
            <button
              type="button"
              onClick={() => setIngestError(null)}
              aria-label="Dismiss"
              className="shrink-0 text-destructive/70 hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {feedError && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">Couldn't load your notes. Check your connection and refresh.</span>
          </div>
        )}

        {!notesReady && !feedError ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </section>
        ) : filtered.length === 0 && pendingJobs.length === 0 ? (
          <EmptyState hasNotes={notes.length > 0 || active !== "all" || source !== "all" || !!query.trim()} />
        ) : layout === "condensed" ? (
          <NoteRowList notes={filtered} jobs={pendingJobs} />
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pendingJobs.map((j) => (
              <ProcessingCard key={j.id} job={j} />
            ))}
            {filtered.map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
          </section>
        )}

        {notesReady && notes.length >= max && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setMax((m) => m + 50)}
              className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-accent"
            >
              Load older notes
            </button>
          </div>
        )}
      </main>

      <button
        type="button"
        onClick={() => {
          setPendingUrl("");
          setShowAdd(true);
        }}
        aria-label="Add note"
        className="fixed bottom-8 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-transform active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>

      {showAdd && (
        <AddSheet
          url={pendingUrl}
          setUrl={setPendingUrl}
          onCancel={() => setShowAdd(false)}
          onSubmit={handleCapture}
        />
      )}
    </AppShell>
  );
}

function AddSheet({
  url,
  setUrl,
  onCancel,
  onSubmit,
}: {
  url: string;
  setUrl: (v: string) => void;
  onCancel: () => void;
  onSubmit: (u: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm md:items-center md:p-4">
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-2xl md:rounded-3xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
        <h2 className="font-serif text-2xl text-ink">New note</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Paste any link — reel, video, recipe, product, article.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) onSubmit(url.trim());
          }}
          className="mt-4 space-y-3"
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-full border border-border bg-card px-4 py-3 text-sm font-medium text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="flex-1 rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper disabled:opacity-50"
            >
              Capture
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyState({ hasNotes }: { hasNotes: boolean }) {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-summary-soft">
        <Sparkles className="h-5 w-5 text-summary" />
      </div>
      <h3 className="mt-4 font-serif text-2xl text-ink">
        {hasNotes ? "Nothing matches" : "No notes yet"}
      </h3>
      <p className="mt-2 text-sm text-ink-soft">
        {hasNotes ? "Try a different search or filter." : "Tap + to clip your first link."}
      </p>
    </div>
  );
}
