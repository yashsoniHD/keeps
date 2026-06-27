import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Search,
  Sparkles,
  Plus,
  WandSparkles,
  Settings,
  AlertCircle,
  X,
  Check,
  Layers,
  Link2,
  AlignLeft,
  ImagePlus,
  Mic,
  ArrowLeft,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import {
  watchNotes,
  watchPendingJobs,
  getUserCategories,
  getUserSources,
  getOnboardingDone,
  setOnboardingDone,
} from "@/lib/firestore";
import { ingest, ingestMedia, ingestText, ingestVoice, searchNotes } from "@/lib/api";
import { analytics } from "@/lib/analytics";
import {
  enqueueCapture,
  isQueueableError,
  loadQueue,
  replayQueue,
  type QueuedCapture,
} from "@/lib/capture-queue";
import { groupNotesByDate, noteAccent, noteIcon, noteLabel, sourceLabel } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { NoteCard, NoteRowList, ProcessingCard, FailedCard } from "@/components/NoteCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GettingStarted } from "@/components/GettingStarted";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { AppShell } from "@/components/AppShell";
import type { Note, Job } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Feed });

type Layout = "standard" | "condensed";

// Round header icon button: 40px tap target, hairline border, with the shared focus ring.
// (The + FAB is intentionally left without a focus ring.)
const ICON_BTN = `inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`;
const GRID_CLS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

// First-run "try a sample" link: lets a new user reach the aha (a real, structured note)
// in one tap, without having to go find a URL. It runs the real pipeline — a recipe page
// with JSON-LD makes the most visually striking first note. Curated; verify it still
// resolves if first-run extraction ever looks off.
const SAMPLE_LINK = "https://www.bbcgoodfood.com/recipes/best-ever-chocolate-brownies-recipe";

// Tracks whether a horizontal scroller sits at its start/end, so the caller can show edge
// fades only when content actually overflows. Recomputes on scroll, on resize, and when
// `deps` change (e.g. the category list grows — which changes scrollWidth, not box size).
function useScrollEdges<T extends HTMLElement>(deps: unknown[]) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setEdges({
        atStart: scrollLeft <= 1,
        atEnd: scrollLeft + clientWidth >= scrollWidth - 1,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, ...edges };
}

function Feed() {
  const { user, loading } = useAuth();
  useCategoryMeta(); // re-render the feed when category icon/colour overrides load or change
  const navigate = useNavigate();
  const { openChat } = useAsk();
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
    // Logged-out visitors land on the marketing page (the pitch + signup CTA),
    // not the bare sign-in screen — that's where cold traffic converts.
    if (!loading && !user) navigate({ to: "/landing" });
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
      analytics.firstCapture(); // funnel: first successful capture (once per browser)
      analytics.noteSaved();
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

  // A URL pasted on the landing page before sign-in is parked in localStorage and
  // captured here once the user is authed — so "Try it free" lands a real first note
  // instead of dropping the user onto an empty feed.
  const pendingHandled = useRef(false);
  useEffect(() => {
    if (!user || pendingHandled.current) return;
    let pending: string | null = null;
    try {
      pending = localStorage.getItem("clipnote.pendingCapture");
      if (pending) localStorage.removeItem("clipnote.pendingCapture");
    } catch {
      /* private mode / storage disabled — nothing to replay */
    }
    if (!pending) return;
    pendingHandled.current = true;
    handleCapture(pending);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Funnel signals: a per-day "returned" visit, and the activation milestone the moment
  // the user's first note actually renders (both dedupe internally).
  useEffect(() => {
    if (user) analytics.returned();
  }, [user]);
  useEffect(() => {
    if (notes.length > 0) analytics.activated();
  }, [notes.length]);

  // Typed-note capture: no URL, so no optimistic placeholder (the real job card lands in a
  // few hundred ms and drives the feedback). The offline replay queue only knows how to
  // replay URLs, so a failed text/file capture surfaces an error rather than being parked.
  const handleCaptureText = async (text: string, title?: string) => {
    setShowAdd(false);
    setIngestError(null);
    try {
      await ingestText(text, title);
      analytics.noteSaved();
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : "Couldn't save the note.");
    }
  };

  // Image/PDF capture: the multipart upload to GCS takes a beat, so AddSheet shows its own
  // "Adding…" state and awaits this; we only surface errors here.
  const handleUploadFile = async (file: File, kind: "image" | "pdf") => {
    setIngestError(null);
    await ingestMedia(file, kind, file.name);
    analytics.noteSaved();
    setShowAdd(false);
  };

  // Voice capture: the recorder hands us an audio Blob; upload it (multipart, like a file)
  // and let the worker transcribe + structure it. AddSheet awaits this and shows its own
  // "Saving…" state; errors surface in the feed.
  const handleUploadVoice = async (blob: Blob) => {
    setIngestError(null);
    await ingestVoice(blob);
    analytics.noteSaved();
    setShowAdd(false);
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

  // Edge fades on the category scroller — only shown when chips actually overflow.
  const {
    ref: catScrollRef,
    atStart: catAtStart,
    atEnd: catAtEnd,
  } = useScrollEdges<HTMLDivElement>([categories.length, sources.length]);

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
          results.map(
            (r) => ({ ...r, source_url: "", source: "web", data: {} }) as unknown as Note,
          ),
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

  // Captures parked by the global daily cap (launch-spike protection). They render as a calm
  // "Queued — high demand" card instead of an error, and drain automatically when budget frees.
  const deferredJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all" || query.trim()) return [];
    const noteUrls = new Set(notes.map((n) => n.source_url));
    return jobs.filter((j) => j.status === "deferred" && !noteUrls.has(j.url));
  }, [jobs, notes, active, source, query]);

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
                  onBlur={() => {
                    // Dismissing the keyboard blurs the input — collapse the bar so an
                    // empty search doesn't linger. A typed query stays open, since
                    // scrolling results on mobile also blurs and shouldn't wipe them.
                    if (!query.trim()) setSearchOpen(false);
                  }}
                  placeholder="Search your notes"
                  className="w-full bg-transparent text-base outline-none placeholder:text-ink-soft md:text-sm"
                />
                {/* Only reveal the Clip AI button after the user has typed at least one
                    character — an empty search bar shouldn't suggest AI immediately.
                    onMouseDown.preventDefault keeps the input from blurring (which would
                    collapse the bar) before the click navigates. */}
                {query.trim().length > 0 && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      // Hand the typed query to the global Ask-AI overlay (seeds + auto-sends).
                      openChat(query.trim());
                      setQuery("");
                      setSearchOpen(false);
                    }}
                    aria-label="Clip AI"
                    title="Clip AI"
                    className={`-my-1.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 text-sm font-medium text-paper transition-transform active:scale-95 ${FOCUS_RING}`}
                  >
                    <WandSparkles className="h-4 w-4" />
                    Clip AI
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
              <div className="flex items-center gap-1">
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
                  onClick={() => {
                    setPendingUrl("");
                    setShowAdd(true);
                  }}
                  aria-label="New note"
                  title="New note"
                  className={ICON_BTN}
                >
                  <Plus className="h-4 w-4" />
                </button>
                <Link to="/settings" aria-label="Settings" title="Settings" className={ICON_BTN}>
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
              <div className="min-w-0 flex-1">
                {/* Edge fades via a mask on the scroller itself — fades the actual chips to
                    transparent, so it's background-agnostic (no opaque-overlay seam against the
                    translucent, blurred header) and only fades the side that actually overflows. */}
                <div
                  ref={catScrollRef}
                  className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  style={{
                    WebkitMaskImage: `linear-gradient(to right, ${catAtStart ? "black" : "transparent"}, black 28px, black calc(100% - 28px), ${catAtEnd ? "black" : "transparent"})`,
                    maskImage: `linear-gradient(to right, ${catAtStart ? "black" : "transparent"}, black 28px, black calc(100% - 28px), ${catAtEnd ? "black" : "transparent"})`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActive("all")}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${FOCUS_RING} ${
                      active === "all"
                        ? "bg-ink text-paper"
                        : "border border-border bg-card text-ink-soft hover:text-ink"
                    }`}
                  >
                    All
                  </button>
                  {categories.map((c) => {
                    const accent = noteAccent(c);
                    const Icon = noteIcon(c);
                    const isActive = active === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setActive(c)}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                          isActive ? `${accent.dot} text-white` : accent.chip
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        {noteLabel(c)}
                      </button>
                    );
                  })}
                </div>
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
            onTrySample={() => handleCapture(SAMPLE_LINK)}
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
          deferredJobs.length === 0 &&
          queuedJobs.length === 0 ? (
          showGuide && !searchActive ? null : (
            <EmptyState
              hasNotes={notes.length > 0 || active !== "all" || source !== "all" || searchActive}
              onTrySample={() => handleCapture(SAMPLE_LINK)}
            />
          )
        ) : (
          <div className="space-y-8">
            {/* In-flight captures ("just now") sit above the dated groups. */}
            {(failedJobs.length > 0 ||
              queuedJobs.length > 0 ||
              deferredJobs.length > 0 ||
              pendingJobs.length > 0) &&
              (layout === "condensed" ? (
                <NoteRowList
                  notes={[]}
                  jobs={pendingJobs}
                  queuedJobs={queuedJobs}
                  deferredJobs={deferredJobs}
                  failedJobs={failedJobs}
                  onRetry={retryJob}
                  onDismiss={dismissJob}
                />
              ) : (
                <section className={GRID_CLS}>
                  {failedJobs.map((j) => (
                    <FailedCard key={j.id} job={j} onRetry={retryJob} onDismiss={dismissJob} />
                  ))}
                  {deferredJobs.map((j) => (
                    <ProcessingCard key={j.id} job={j} label="Queued — high demand" />
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

      {/* The bottom-right FAB is now the global Ask-AI button (components/ask/AskFab.tsx);
          search moved to the top bar. */}

      {showAdd && (
        <AddSheet
          url={pendingUrl}
          setUrl={setPendingUrl}
          onCancel={() => setShowAdd(false)}
          onSubmit={handleCapture}
          onSubmitText={handleCaptureText}
          onUploadFile={handleUploadFile}
          onUploadVoice={handleUploadVoice}
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
  const btnRef = useRef<HTMLButtonElement>(null);
  // Anchor coords for the portaled menu. The menu is rendered into <body> (not here) so
  // it escapes the header's backdrop-filter, which otherwise traps fixed-position children
  // to the header's box — that's what let outside taps fall through to the notes below.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, left: r.left });
  }, [open]);

  const options = [
    { id: "all", label: "All sources" },
    ...sources.map((s) => ({ id: s, label: sourceLabel(s) })),
  ];

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
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

      {open &&
        pos &&
        createPortal(
          <>
            {/* Full-viewport catcher at <body> root: an outside tap closes the menu AND is
                consumed here, so it never falls through to (and opens) a note behind it. */}
            <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => setOpen(false)} />
            <div
              role="listbox"
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-[61] max-h-72 w-52 overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 shadow-2xl"
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
          </>,
          document.body,
        )}
    </div>
  );
}

// The four capture modes shown in the picker. Upload jumps straight to the file dialog
// (no sub-view); the others open a focused sub-view. Tints reuse the note-type theme
// tokens so the icon tiles work in dark mode for free.
const CAPTURE_MODES = [
  {
    key: "link",
    icon: Link2,
    tile: "bg-tech-soft text-tech",
    title: "Paste a link",
    desc: "Article, video, post",
  },
  {
    key: "text",
    icon: AlignLeft,
    tile: "bg-muted text-ink-soft",
    title: "Write a note",
    desc: "Type or paste text",
  },
  {
    key: "upload",
    icon: ImagePlus,
    tile: "bg-itinerary-soft text-itinerary",
    title: "Upload a file",
    desc: "Image, video, PDF",
  },
  {
    key: "voice",
    icon: Mic,
    tile: "bg-health-soft text-health",
    title: "Voice note",
    desc: "Record & transcribe",
  },
] as const;

function AddSheet({
  url,
  setUrl,
  onCancel,
  onSubmit,
  onSubmitText,
  onUploadFile,
  onUploadVoice,
}: {
  url: string;
  setUrl: (v: string) => void;
  onCancel: () => void;
  onSubmit: (u: string) => void;
  onSubmitText: (text: string, title?: string) => void;
  onUploadFile: (file: File, kind: "image" | "pdf") => Promise<void>;
  onUploadVoice: (blob: Blob) => Promise<void>;
}) {
  // Menu-first: the sheet opens on the picker, never on an input — so no keyboard springs
  // up and (since we no longer read the clipboard on mount) no desktop "Paste" prompt fires.
  const [view, setView] = useState<"menu" | "link" | "text" | "voice">("menu");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    const kind: "image" | "pdf" | null = file.type.startsWith("image/")
      ? "image"
      : file.type === "application/pdf"
        ? "pdf"
        : null;
    if (!kind) {
      setFileError("Pick an image or a PDF.");
      return;
    }
    setFileError(null);
    setUploading(true);
    try {
      await onUploadFile(file, kind); // closes the sheet on success
    } catch (e) {
      setUploading(false);
      setFileError(e instanceof Error ? e.message : "Couldn't add that file.");
    }
  };

  const pick = (key: (typeof CAPTURE_MODES)[number]["key"]) => {
    if (key === "upload") fileRef.current?.click();
    else setView(key);
  };

  // A back arrow that returns to the picker — sub-views are one tap from the menu.
  const Back = () => (
    <button
      type="button"
      onClick={() => setView("menu")}
      aria-label="Back"
      className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );

  return (
    <div
      data-no-refresh
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div className="w-full rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:max-w-md sm:rounded-3xl">
        {/* Hidden file input lives at the top level so the "Upload a file" card can trigger it
            from the menu without a dedicated sub-view. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => onFilePicked(e.target.files?.[0])}
        />

        {view === "menu" && (
          <>
            <h2 className="font-serif text-3xl text-ink">New note</h2>
            <p className="mt-1 text-sm text-ink-soft">What are you saving?</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {CAPTURE_MODES.map((m) => {
                const Icon = m.icon;
                const busy = m.key === "upload" && uploading;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => pick(m.key)}
                    disabled={busy}
                    className={`flex flex-col gap-3 rounded-2xl border border-border bg-paper p-4 text-left transition-colors hover:bg-accent disabled:opacity-60 ${FOCUS_RING}`}
                  >
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-xl ${m.tile}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block font-semibold text-ink">{m.title}</span>
                      <span className="mt-0.5 block text-sm text-ink-soft">
                        {busy ? "Adding…" : m.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {fileError && <p className="mt-3 text-sm text-red-600">{fileError}</p>}
            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-sm text-product">
              <Sparkles className="h-4 w-4 shrink-0" />
              Whatever you pick, Clipnote titles and tags it for you
            </p>
          </>
        )}

        {view === "link" && (
          <>
            <div className="flex items-center gap-2">
              <Back />
              <h2 className="font-serif text-2xl text-ink">Paste a link</h2>
            </div>
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
              <button
                type="submit"
                disabled={!url.trim()}
                className="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper disabled:opacity-50"
              >
                Capture
              </button>
            </form>
          </>
        )}

        {view === "text" && (
          <>
            <div className="flex items-center gap-2">
              <Back />
              <h2 className="font-serif text-2xl text-ink">Write a note</h2>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onSubmitText(text.trim(), title.trim() || undefined);
              }}
              className="mt-4 space-y-3"
            >
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (optional)"
                autoComplete="off"
                className="w-full rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink"
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type or paste anything…"
                rows={4}
                className="w-full resize-none rounded-2xl border border-border bg-paper px-4 py-3 text-base outline-none focus:border-ink"
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className="w-full rounded-full bg-ink px-4 py-3 text-sm font-medium text-paper disabled:opacity-50"
              >
                Save note
              </button>
            </form>
          </>
        )}

        {view === "voice" && (
          <>
            <div className="flex items-center gap-2">
              <Back />
              <h2 className="font-serif text-2xl text-ink">Voice note</h2>
            </div>
            <VoiceRecorder onSave={onUploadVoice} className="mt-4" />
          </>
        )}

        {view === "menu" && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-4 w-full rounded-full border border-border bg-card px-4 py-3 text-sm font-medium text-ink"
          >
            Cancel
          </button>
        )}
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

function EmptyState({ hasNotes, onTrySample }: { hasNotes: boolean; onTrySample?: () => void }) {
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-dashed border-border bg-card p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-summary-soft">
        <Sparkles className="h-5 w-5 text-summary" />
      </div>
      <h3 className="mt-4 font-serif text-2xl text-ink">
        {hasNotes ? "Nothing matches" : "No notes yet"}
      </h3>
      <p className="mt-2 text-sm text-ink-soft">
        {hasNotes
          ? "Try a different search or filter."
          : "Tap + to clip your first link — or see one in action."}
      </p>
      {!hasNotes && onTrySample && (
        <button
          type="button"
          onClick={onTrySample}
          className={`mt-5 inline-flex items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <WandSparkles className="h-4 w-4" />
          Try a sample note
        </button>
      )}
    </div>
  );
}
