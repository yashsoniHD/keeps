import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Search,
  Sparkles,
  Plus,
  LayoutGrid,
  List,
  WandSparkles,
  Settings,
  AlertCircle,
  X,
  Check,
  Layers,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  watchNotes,
  watchPendingJobs,
  getUserCategories,
  getUserSources,
  getOnboardingDone,
  setOnboardingDone,
} from "@/lib/firestore";
import { ingest, searchNotes } from "@/lib/api";
import {
  enqueueCapture,
  isQueueableError,
  loadQueue,
  replayQueue,
  type QueuedCapture,
} from "@/lib/capture-queue";
import { groupNotesByDate, noteLabel, sourceLabel } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { NoteCard, NoteRowList, ProcessingCard, FailedCard } from "@/components/NoteCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GettingStarted } from "@/components/GettingStarted";
import { AppShell } from "@/components/AppShell";
import type { Note, Job } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Feed });

type Layout = "standard" | "condensed";

// Round header icon button: 40px tap target, hairline border, with the shared focus ring.
// (The + FAB is intentionally left without a focus ring.)
const ICON_BTN = `inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`;
const GRID_CLS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function Feed() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesReady, setNotesReady] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [max, setMax] = useState(50);
  const [userCategories, setUserCategories] = useState<string[]>([]);
  const [userSources, setUserSources] = useState<string[]>([]);
  const [active, setActive] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>(
    () => (localStorage.getItem("clipnote.layout") as Layout) || "standard",
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dismissedJobs, setDismissedJobs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("clipnote.dismissedJobs") || "[]");
    } catch {
      return [];
    }
  });
  const [optimistic, setOptimistic] = useState<{ id: string; url: string }[]>([]);
  const [queued, setQueued] = useState<QueuedCapture[]>(loadQueue);
  const [showGuide, setShowGuide] = useState(false);
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
    getUserCategories(user.uid)
      .then(setUserCategories)
      .catch(() => {});
    getUserSources(user.uid)
      .then(setUserSources)
      .catch(() => {});
  }, [user]);

  // In-flight captures → optimistic "processing" cards (works for every capture path).
  useEffect(() => {
    if (!user) return;
    return watchPendingJobs(user.uid, setJobs);
  }, [user]);

  // Offline-queued captures replay on mount and whenever the connection returns.
  // Server-rejected entries (4xx) are dropped with their error surfaced — they'd
  // fail identically forever; network failures keep the rest of the queue intact.
  useEffect(() => {
    if (!user) return;
    const replay = () => {
      if (loadQueue().length === 0) return;
      replayQueue((_url, message) => setIngestError(message)).then(setQueued);
    };
    replay();
    window.addEventListener("online", replay);
    return () => window.removeEventListener("online", replay);
  }, [user]);

  // Getting-started guide: shown until users/{uid}.onboarding_done (cross-device);
  // the localStorage mirror prevents a flash of the guide on every load after dismissal.
  useEffect(() => {
    if (!user || localStorage.getItem("clipnote.onboardingDone") === "1") return;
    getOnboardingDone(user.uid)
      .then((done) => {
        if (done) localStorage.setItem("clipnote.onboardingDone", "1");
        else setShowGuide(true);
      })
      .catch(() => {});
  }, [user]);

  const dismissGuide = () => {
    setShowGuide(false);
    try {
      localStorage.setItem("clipnote.onboardingDone", "1");
    } catch {
      /* mirror only — the Firestore flag below is the durable copy */
    }
    if (user) setOnboardingDone(user.uid).catch(() => {});
  };

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
      if (isQueueableError(e)) {
        // Offline / server down: hold the URL locally and show a "waiting" card —
        // the capture is parked, not lost. Replayed by the effect above.
        setQueued(enqueueCapture(url));
      } else {
        setIngestError(
          e instanceof Error ? e.message : "Couldn't start the capture. Please try again.",
        );
      }
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
  // Sources come from users/{uid}.sources (whole-corpus source of truth) unioned with
  // loaded notes, so the source filter doesn't vanish when a server-side category filter
  // narrows the loaded notes to a single domain — same trick as the category chips above.
  const sources = useMemo(
    () => Array.from(new Set([...userSources, ...notes.map((n) => n.source_domain)])).sort(),
    [notes, userSources],
  );

  // Browse view: the live feed filtered only by the type/source chips. Text queries no
  // longer filter this slice — they run server-side semantic search (below) over the
  // whole corpus, not just the loaded window.
  const filtered = useMemo(() => {
    return notes.filter((n) => {
      if (active !== "all" && n.content_type !== active) return false;
      if (source !== "all" && n.source_domain !== source) return false;
      return true;
    });
  }, [notes, active, source]);

  // Semantic search: debounced server call over all the user's notes (Firestore Vector
  // Search). Empty/short queries fall back to the browse feed. Results are projected
  // (no created_at/data), which NoteCard renders fine.
  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery.length >= 3;
  const [searchResults, setSearchResults] = useState<Note[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!searchActive) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const results = await searchNotes(trimmedQuery);
        setSearchResults(
          results.map((r) => ({ ...r, source_url: "", source: "web", data: {} }) as unknown as Note),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [trimmedQuery, searchActive]);

  // What the feed actually renders: search results (re-filtered by the chips) when a
  // query is active, otherwise the browse feed.
  const displayNotes = useMemo(() => {
    if (!searchActive) return filtered;
    return (searchResults ?? []).filter((n) => {
      if (active !== "all" && n.content_type !== active) return false;
      if (source !== "all" && n.source_domain !== source) return false;
      return true;
    });
  }, [searchActive, searchResults, filtered, active, source]);

  // Date-bucketed feed (Today / Yesterday / This Week / …). Search results stay flat —
  // grouping a relevance-ranked list by recency would be misleading.
  const dateGroups = useMemo(
    () => (searchActive ? null : groupNotesByDate(displayNotes)),
    [searchActive, displayNotes],
  );

  // Processing cards show only on the default view — an in-flight job has no type/title
  // yet to match a filter or search. Merge server jobs with not-yet-acknowledged local
  // placeholders, drop any whose note already landed (the brief completion overlap).
  const pendingJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all" || query.trim()) return [];
    const inflight = jobs.filter((j) => j.status === "pending" || j.status === "processing");
    const noteUrls = new Set(notes.map((n) => n.source_url));
    const jobUrls = new Set(jobs.map((j) => j.url));
    const placeholders = optimistic
      .filter((o) => !jobUrls.has(o.url) && !noteUrls.has(o.url))
      .map((o) => ({ id: o.id, url: o.url, status: "pending" }) as Job);
    return [...placeholders, ...inflight.filter((j) => !noteUrls.has(j.url))];
  }, [jobs, optimistic, notes, active, source, query]);

  // Offline-held captures render as "waiting" cards so they're visibly parked. Hidden
  // once a real job/note for the same URL exists (replay succeeded elsewhere).
  const queuedJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all" || query.trim()) return [];
    const jobUrls = new Set(jobs.map((j) => j.url));
    const noteUrls = new Set(notes.map((n) => n.source_url));
    return queued
      .filter((q) => !jobUrls.has(q.url) && !noteUrls.has(q.url))
      .map((q) => ({ id: `queued-${q.url}`, url: q.url, status: "pending" }) as Job);
  }, [queued, jobs, notes, active, source, query]);

  // Failed captures stay visible (with the error) until dismissed or retried — a card
  // that silently disappears reads as data loss.
  const failedJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all" || query.trim()) return [];
    return jobs.filter((j) => j.status === "failed" && !dismissedJobs.includes(j.id));
  }, [jobs, dismissedJobs, active, source, query]);

  const dismissJob = (jobId: string) => {
    setDismissedJobs((prev) => {
      const next = [...prev.filter((id) => id !== jobId), jobId].slice(-100);
      localStorage.setItem("clipnote.dismissedJobs", JSON.stringify(next));
      return next;
    });
  };

  const retryJob = (job: Job) => {
    dismissJob(job.id);
    handleCapture(job.url);
  };

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
          {searchOpen ? (
            <div className="mb-3 flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-full border border-border bg-card py-2.5 pl-4 pr-1.5">
                <Search className="h-4 w-4 shrink-0 text-ink-soft" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setQuery("");
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Search your notes"
                  className="w-full bg-transparent text-base outline-none placeholder:text-ink-soft md:text-sm"
                />
                {query.trim() && (
                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        to: "/ask",
                        search: { q: query.trim(), send: true },
                      })
                    }
                    aria-label="Ask AI"
                    title="Ask AI"
                    className={`-my-1.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-sm font-medium text-paper transition-transform active:scale-95 ${FOCUS_RING}`}
                  >
                    <WandSparkles className="h-4 w-4" />
                    Ask AI
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
                aria-label="Close search"
                className={`shrink-0 ${ICON_BTN}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
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
                  onClick={() => setSearchOpen(true)}
                  aria-label="Search notes"
                  title="Search"
                  className={ICON_BTN}
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={toggleLayout}
                  aria-label={
                    layout === "standard" ? "Switch to condensed layout" : "Switch to card layout"
                  }
                  title={layout === "standard" ? "Condensed view" : "Card view"}
                  className={ICON_BTN}
                >
                  {layout === "standard" ? (
                    <List className="h-4 w-4" />
                  ) : (
                    <LayoutGrid className="h-4 w-4" />
                  )}
                </button>
                <Link
                  to="/settings"
                  aria-label="Settings"
                  title="Settings"
                  className={ICON_BTN}
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )}

          {(categories.length > 0 || sources.length > 1) && (
            <div className="flex items-center gap-2">
              {sources.length > 1 && (
                <SourceFilter sources={sources} source={source} setSource={setSource} />
              )}
              <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 py-1">
                {[
                  { id: "all", label: "All" },
                  ...categories.map((c) => ({ id: c, label: noteLabel(c) })),
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setActive(f.id)}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${FOCUS_RING} ${
                      active === f.id
                        ? "bg-ink text-paper"
                        : "border border-border bg-card text-ink-soft hover:text-ink"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
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
            <span className="flex-1">
              Couldn't load your notes. Check your connection and refresh.
            </span>
          </div>
        )}

        {notesReady && showGuide && (
          <GettingStarted
            notesCount={notes.length}
            onAddLink={() => {
              setPendingUrl("");
              setShowAdd(true);
            }}
            onDismiss={dismissGuide}
          />
        )}

        {(!notesReady && !feedError) || (searchActive && searching && searchResults === null) ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="h-48 animate-pulse rounded-2xl border border-border bg-card"
              />
            ))}
          </section>
        ) : displayNotes.length === 0 &&
          pendingJobs.length === 0 &&
          failedJobs.length === 0 &&
          queuedJobs.length === 0 ? (
          showGuide && !searchActive ? null : (
            <EmptyState
              hasNotes={notes.length > 0 || active !== "all" || source !== "all" || searchActive}
            />
          )
        ) : (
          <div className="space-y-8">
            {/* In-flight captures ("just now") sit above the dated groups. */}
            {(failedJobs.length > 0 || queuedJobs.length > 0 || pendingJobs.length > 0) &&
              (layout === "condensed" ? (
                <NoteRowList
                  notes={[]}
                  jobs={pendingJobs}
                  queuedJobs={queuedJobs}
                  failedJobs={failedJobs}
                  onRetry={retryJob}
                  onDismiss={dismissJob}
                />
              ) : (
                <section className={GRID_CLS}>
                  {failedJobs.map((j) => (
                    <FailedCard key={j.id} job={j} onRetry={retryJob} onDismiss={dismissJob} />
                  ))}
                  {queuedJobs.map((j) => (
                    <ProcessingCard key={j.id} job={j} label="Waiting for connection" />
                  ))}
                  {pendingJobs.map((j) => (
                    <ProcessingCard key={j.id} job={j} />
                  ))}
                </section>
              ))}

            {dateGroups ? (
              dateGroups.map((g) => (
                <div key={g.key}>
                  <h2 className="mb-3 text-xs uppercase tracking-wider text-ink-soft">{g.label}</h2>
                  {layout === "condensed" ? (
                    <NoteRowList notes={g.notes} />
                  ) : (
                    <NoteGrid notes={g.notes} />
                  )}
                </div>
              ))
            ) : layout === "condensed" ? (
              <NoteRowList notes={displayNotes} />
            ) : (
              <NoteGrid notes={displayNotes} />
            )}
          </div>
        )}

        {notesReady && !searchActive && notes.length >= max && (
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

// Platform logo for a source domain. Lucide has no brand icons, so we pull the
// site's favicon (Google's service returns a generic globe for unknown domains).
function SourceLogo({ domain, className }: { domain: string; className?: string }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      aria-hidden
      loading="lazy"
      className={className}
    />
  );
}

// Source filter: a custom dropdown (native <select> can't render logos) showing
// each platform's favicon beside its name, on a popover surface.
function SourceFilter({
  sources,
  source,
  setSource,
}: {
  sources: string[];
  source: string;
  setSource: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const options = [{ id: "all", label: "All sources" }, ...sources.map((s) => ({ id: s, label: sourceLabel(s) }))];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Filter by source"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${FOCUS_RING} ${
          source !== "all"
            ? "border-ink bg-card"
            : "border-border bg-card text-ink-soft hover:text-ink"
        }`}
      >
        {source !== "all" ? (
          <SourceLogo domain={source} className="h-5 w-5 rounded" />
        ) : (
          <Layers className="h-4 w-4" />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-2 max-h-72 w-52 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 shadow-2xl"
        >
          {options.map((o) => {
            const selected = source === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setSource(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm capitalize transition-colors ${
                  selected ? "bg-ink/5 text-ink" : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                }`}
              >
                {o.id === "all" ? (
                  <Layers className="h-5 w-5 shrink-0 text-ink-soft" />
                ) : (
                  <SourceLogo domain={o.id} className="h-5 w-5 shrink-0 rounded" />
                )}
                <span className="flex-1 truncate">{o.label}</span>
                {selected && <Check className="h-4 w-4 shrink-0 text-ink" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
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
    <div
      data-no-refresh
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm md:items-center md:p-4"
    >
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-5 shadow-2xl md:rounded-3xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
        <h2 className="font-serif text-2xl text-ink">New note</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Paste any link: reel, video, recipe, product, article.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) onSubmit(url.trim());
          }}
          className="mt-4 space-y-3"
        >
          <input
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

// A responsive grid of note cards, each isolated by an error boundary so one bad note
// can't blank the whole feed.
function NoteGrid({ notes }: { notes: Note[] }) {
  return (
    <section className={GRID_CLS}>
      {notes.map((n) => (
        <ErrorBoundary key={n.id} label="feed-card" fallback={<FallbackNoteCard note={n} />}>
          <NoteCard note={n} />
        </ErrorBoundary>
      ))}
    </section>
  );
}

// Boundary fallback for a feed card whose data breaks NoteCard's render: title-only,
// still clickable (the detail route has its own deeper fallback ladder).
function FallbackNoteCard({ note }: { note: Note }) {
  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className="flex min-w-0 flex-col justify-center rounded-2xl border border-border bg-card p-4"
    >
      <h3 className="font-serif text-xl leading-tight text-ink line-clamp-2">{note.title}</h3>
      <p className="mt-2 text-sm text-ink-soft">Preview unavailable. Tap to open.</p>
    </Link>
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
