import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, Sparkles, Plus, LayoutGrid, List, Globe, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { watchNotes, deleteNote } from "@/lib/firestore";
import { noteLabel } from "@/lib/note-meta";
import { NoteCard, NoteRow } from "@/components/NoteCard";
import { CaptureModal } from "@/components/CaptureModal";
import { AppShell } from "@/components/AppShell";
import type { Note } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Feed });

type Layout = "standard" | "condensed";

function Feed() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<Layout>(
    () => (localStorage.getItem("clipnote.layout") as Layout) || "standard",
  );
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pendingUrl, setPendingUrl] = useState("");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Real-time feed: new/updated notes stream in without a refetch.
  useEffect(() => {
    if (!user) return;
    return watchNotes(user.uid, setNotes);
  }, [user]);

  const toggleLayout = () => {
    const next: Layout = layout === "standard" ? "condensed" : "standard";
    setLayout(next);
    localStorage.setItem("clipnote.layout", next);
  };

  // Filter chips emerge from the notes themselves — the user's personal taxonomy.
  const categories = useMemo(
    () => Array.from(new Set(notes.map((n) => n.content_type))).sort(),
    [notes],
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
            <button
              type="button"
              onClick={toggleLayout}
              aria-label={layout === "standard" ? "Switch to condensed layout" : "Switch to card layout"}
              title={layout === "standard" ? "Condensed view" : "Card view"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink"
            >
              {layout === "standard" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            </button>
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
                      {s}
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
        {filtered.length === 0 ? (
          <EmptyState hasNotes={notes.length > 0} />
        ) : layout === "condensed" ? (
          <section className="grid gap-2 lg:grid-cols-2">
            {filtered.map((n) => (
              <NoteRow key={n.id} note={n} onDelete={() => deleteNote(n.id)} />
            ))}
          </section>
        ) : (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((n) => (
              <NoteCard key={n.id} note={n} onDelete={() => deleteNote(n.id)} />
            ))}
          </section>
        )}
      </main>

      <button
        type="button"
        onClick={() => {
          setPendingUrl("");
          setShowAdd(true);
        }}
        aria-label="Add note"
        className="fixed bottom-20 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-transform active:scale-95 md:bottom-8"
      >
        <Plus className="h-6 w-6" />
      </button>

      {showAdd && !captureUrl && (
        <AddSheet
          url={pendingUrl}
          setUrl={setPendingUrl}
          onCancel={() => setShowAdd(false)}
          onSubmit={(u) => {
            setCaptureUrl(u);
            setShowAdd(false);
          }}
        />
      )}
      {captureUrl && <CaptureModal url={captureUrl} onClose={() => setCaptureUrl(null)} />}
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
