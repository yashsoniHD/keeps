import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  Search,
  Sparkles,
  WandSparkles,
  AlertCircle,
  X,
  Check,
  Link2,
  ArrowLeft,
  Pin,
  LayoutGrid,
  LayoutDashboard,
  GalleryHorizontalEnd,
  Rows3,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import {
  watchNotes,
  watchPendingJobs,
  watchCollections,
  getUserCategories,
  getOnboardingDone,
  setOnboardingDone,
} from "@/lib/firestore";
import { ingest, ingestMedia, ingestText, ingestVoice } from "@/lib/api";
import { analytics } from "@/lib/analytics";
import {
  enqueueCapture,
  isQueueableError,
  loadQueue,
  replayQueue,
  type QueuedCapture,
} from "@/lib/capture-queue";
import {
  groupNotesByDate,
  groupNotesByCategory,
  noteAccent,
  noteIcon,
  noteLabel,
  type CategoryGroup,
} from "@/lib/note-meta";
import { setFeedOrder } from "@/lib/note-nav";
import { getCached, hasCached, setCached } from "@/lib/swr-cache";
import { FOCUS_RING } from "@/lib/ui";
import { PillButton } from "@/components/shared/PillButton";
import { SettingsAvatarLink } from "@/components/shared/SettingsAvatarLink";
import {
  NoteCard,
  NoteRowList,
  ProcessingCard,
  FailedCard,
  BoardCard,
} from "@/components/NoteCard";
import { NoteMenuProvider } from "@/components/NoteContextMenu";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GettingStarted } from "@/components/GettingStarted";
import { AddNoteSheet } from "@/components/AddNoteSheet";
import { AppShell } from "@/components/AppShell";
import { CategoryChips } from "@/components/feed/CategoryFilter";
import { ClipMark, ClipLoader } from "@/components/ClipMark";
import { useLayout, type Layout } from "@/lib/layout";
import type { Note, Job, Collection } from "@/lib/types";

// The notes feed. Home (`/`) is the ONE feed (Feed with `home`). The old `/notes` view was a
// second, identical feed from the collections era; with collections gone it was just a duplicate
// (opening a note then going Back landed here), so `/notes` now redirects to home.
export const Route = createFileRoute("/notes/")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

// Round header icon button: 40px tap target, hairline border, with the shared focus ring.
// (The + FAB is intentionally left without a focus ring.)
const ICON_BTN = `inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`;
const GRID_CLS = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

// First-run "try a sample" link: lets a new user reach the aha (a real, structured note)
// in one tap, without having to go find a URL. It runs the real pipeline — a recipe page
// with JSON-LD makes the most visually striking first note. Curated; verify it still
// resolves if first-run extraction ever looks off.
const SAMPLE_LINK = "https://www.bbcgoodfood.com/recipes/best-ever-chocolate-brownies-recipe";

export function Feed({
  home = false,
  typeParam,
  openAsk = false,
}: {
  home?: boolean;
  typeParam?: string;
  openAsk?: boolean;
}) {
  const { user, loading } = useAuth();
  useCategoryMeta(); // re-render the feed when category icon/colour overrides load or change
  const navigate = useNavigate();
  const { openChat } = useAsk();
  const askConsumed = useRef(false);
  // Seed from the SWR cache so back-navigation renders the last-seen feed instantly instead of
  // a multi-second skeleton; the live listener below revalidates in the background. Keys are
  // uid-scoped and the notes key also carries the active type (the server-side filter), so a
  // filtered view never seeds from the wrong slice. `user`/`typeParam` are stable at mount.
  const [notes, setNotes] = useState<Note[]>(() =>
    user ? (getCached<Note[]>(`feed:${user.uid}:${typeParam ?? "all"}`) ?? []) : [],
  );
  const [collections, setCollections] = useState<Collection[]>(() =>
    user ? (getCached<Collection[]>(`collections:${user.uid}`) ?? []) : [],
  );
  const [notesReady, setNotesReady] = useState(() =>
    user ? hasCached(`feed:${user.uid}:${typeParam ?? "all"}`) : false,
  );
  const [feedError, setFeedError] = useState(false);
  const [max, setMax] = useState(50);
  const [userCategories, setUserCategories] = useState<string[]>([]);
  const [active, setActive] = useState<string>(typeParam ?? "all");
  // The view toggle (Cards / Board / Compact) lives both in the header (LayoutToggle, below)
  // and in Settings (Appearance) — the hook syncs both via localStorage + a custom event, so
  // switching one updates the other live.
  const [layout, setLayout] = useLayout();
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
    // Logged-out visitors go straight to sign-in.
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Filter chips emerge from the user's own taxonomy (user doc + loaded notes). This flat slug
  // list still feeds the note context menu ("move to category"); the chip row uses the deduped
  // groups below.
  const categories = useMemo(
    () => Array.from(new Set([...userCategories, ...notes.map((n) => n.content_type)])).sort(),
    [notes, userCategories],
  );
  // Chip groups: different slugs can share a display label (itinerary + trip → "Trips";
  // travel + travel-destination-guide → "Travel"). Rendering one chip per slug showed
  // duplicate-looking chips that each filtered a different subset, so collapse by label —
  // one chip per label carrying ALL its slugs — and sort by label.
  const chipGroups = useMemo(() => {
    const byLabel = new Map<string, string[]>();
    for (const slug of categories) {
      const label = noteLabel(slug);
      const arr = byLabel.get(label);
      if (arr) arr.push(slug);
      else byLabel.set(label, [slug]);
    }
    return Array.from(byLabel.entries())
      .map(([label, slugs]) => ({ label, slugs: slugs.slice().sort() }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [categories]);
  // The slug set the active chip filters by: the whole label group `active` belongs to (so a
  // multi-slug chip matches any of its slugs), or just `[active]` when it isn't in a group yet
  // (e.g. a deep link whose category hasn't loaded). Null == "All". `activeKey` is the stable
  // string the feed subscription/cache key off of, so streaming notes don't churn the listener.
  const activeSlugs = useMemo<string[] | null>(() => {
    if (active === "all") return null;
    return chipGroups.find((g) => g.slugs.includes(active))?.slugs ?? [active];
  }, [active, chipGroups]);
  const activeKey = activeSlugs ? activeSlugs.join(",") : "all";

  // Real-time feed: new/updated notes stream in without a refetch. The active type
  // filter runs server-side (composite index), so it sees past the feed window.
  useEffect(() => {
    if (!user) return;
    // activeKey is a stable, comma-joined slug string ("all" == unfiltered); split it back into
    // the slug set so a multi-slug chip filters server-side via a Firestore `in` query.
    const types = activeKey === "all" ? undefined : activeKey.split(",");
    return watchNotes(
      user.uid,
      (n) => {
        setNotes(n);
        setNotesReady(true);
        setFeedError(false);
        // Cache under the raw selected slug (`active`), not the group key: the initial-state
        // read on back-nav looks up `feed:{uid}:{typeParam ?? "all"}`, and typeParam is the
        // single slug from the URL. `active` is also a dep so a group-mate switch re-keys.
        setCached(`feed:${user.uid}:${active}`, n); // warm cache for instant back-nav
      },
      {
        max,
        contentType: types,
        onError: () => setFeedError(true),
      },
    );
  }, [user, max, active, activeKey]);

  // Chip list comes from users/{uid}.categories (source of truth), so chips don't
  // vanish when a server-side filter narrows the loaded notes to one type.
  useEffect(() => {
    if (!user) return;
    getUserCategories(user.uid)
      .then(setUserCategories)
      .catch(() => {});
  }, [user]);

  // In-flight captures → optimistic "processing" cards (works for every capture path).
  useEffect(() => {
    if (!user) return;
    return watchPendingJobs(user.uid, setJobs);
  }, [user]);

  // The user's folders, kept live so every card's context menu offers an up-to-date
  // "Add to collection" list without a per-open fetch.
  useEffect(() => {
    if (!user) return;
    return watchCollections(
      user.uid,
      (c) => {
        setCollections(c);
        setCached(`collections:${user.uid}`, c);
      },
      { onError: () => {} },
    );
  }, [user]);

  // Follow a `?type=` deep link from the Library (and clearing it) into the chip filter.
  useEffect(() => {
    setActive(typeParam ?? "all");
  }, [typeParam]);

  // A `?ask=1` deep link (old /ask bookmarks redirect here) opens Clip AI once, then the param
  // is cleared so a refresh or Back doesn't reopen it. Idempotent via the ref guard.
  useEffect(() => {
    if (!openAsk || askConsumed.current) return;
    askConsumed.current = true;
    openChat();
    // Drop `?ask=1` (keep any active ?type=) so a refresh/Back doesn't reopen the chat.
    navigate({ to: "/", search: typeParam ? { type: typeParam } : {}, replace: true });
  }, [openAsk, openChat, navigate, typeParam]);

  // Set the active category AND mirror it into the URL (?type=…) on the home feed, so opening a
  // note and pressing Back returns to the same category instead of resetting to All. `replace`
  // keeps it out of history (the note push is the real back target).
  const applyActive = useCallback(
    (v: string) => {
      setActive(v);
      if (home) navigate({ to: "/", search: v === "all" ? {} : { type: v }, replace: true });
    },
    [home, navigate],
  );

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
  const handleCaptureText = async (text: string, title?: string, processAI = true) => {
    setShowAdd(false);
    setIngestError(null);
    try {
      await ingestText(text, title, processAI);
      analytics.noteSaved();
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : "Couldn't save the note.");
    }
  };

  // Image/PDF capture: the multipart upload to GCS takes a beat, so AddSheet shows its own
  // "Adding…" state and awaits this; we only surface errors here.
  const handleUploadFile = async (file: File, kind: "image" | "pdf" | "video" | "voice") => {
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

  // Browse view: the live feed filtered only by the category chips. Free-text search now
  // lives on its own route (/search) over the whole corpus, so the feed no longer filters by
  // a query — it's purely the chip-filtered stream. (The old source filter is gone: the
  // source is visible on every card's footer instead.)
  const filtered = useMemo(() => {
    return notes.filter((n) => {
      // Home is THE feed — every note streams here regardless of collection. The /notes
      // deep link stays the catch-all: notes filed into a smart collection live in that
      // collection, not there. Excluded client-side so it works regardless of whether older
      // notes have the collection_id field yet (a Firestore `== null` query would miss those).
      if (!home && n.collection_id) return false;
      if (activeSlugs && !activeSlugs.includes(n.content_type)) return false;
      return true;
    });
  }, [notes, activeSlugs, home]);

  // Pinned notes float into their own section above the dated groups (newest-pinned first),
  // so a note the user marked "come back to this" stays at the top of the feed instead of
  // sinking with age.
  const pinnedNotes = useMemo(() => {
    return filtered
      .filter((n) => n.pinned_at)
      .sort((a, b) => (b.pinned_at?.toMillis() ?? 0) - (a.pinned_at?.toMillis() ?? 0));
  }, [filtered]);

  // Date-bucketed feed (Today / Yesterday / This Week / …), excluding pinned notes (shown above).
  const dateGroups = useMemo(
    () => groupNotesByDate(filtered.filter((n) => !n.pinned_at)),
    [filtered],
  );

  // Shelves view: the same stream re-bucketed by category (one horizontal shelf per label
  // group), excluding pinned notes — they get their own shelf on top, like the date view.
  const shelfGroups = useMemo(
    () => (layout === "shelves" ? groupNotesByCategory(filtered.filter((n) => !n.pinned_at)) : []),
    [layout, filtered],
  );

  // Persist the visible order (pinned first, then the grouped stream — matching what's on
  // screen) so the note view can swipe/arrow to the next note in the same filtered context.
  // Shelves reorder the stream by category, so the swipe order follows the shelves there.
  useEffect(() => {
    const stream =
      layout === "shelves"
        ? shelfGroups.flatMap((g) => g.notes)
        : filtered.filter((n) => !n.pinned_at);
    setFeedOrder([...pinnedNotes.map((n) => n.id), ...stream.map((n) => n.id)]);
  }, [filtered, pinnedNotes, layout, shelfGroups]);

  // Processing cards show only on the default view — an in-flight job has no type/title
  // yet to match a filter or search. Merge server jobs with not-yet-acknowledged local
  // placeholders, drop any whose note already landed (the brief completion overlap).
  const pendingJobs = useMemo<Job[]>(() => {
    if (active !== "all") return [];
    const inflight = jobs.filter((j) => j.status === "pending" || j.status === "processing");
    const noteUrls = new Set(notes.map((n) => n.source_url));
    const jobUrls = new Set(jobs.map((j) => j.url));
    const placeholders = optimistic
      .filter((o) => !jobUrls.has(o.url) && !noteUrls.has(o.url))
      .map((o) => ({ id: o.id, url: o.url, status: "pending" }) as Job);
    return [...placeholders, ...inflight.filter((j) => !noteUrls.has(j.url))];
  }, [jobs, optimistic, notes, active]);

  // Offline-held captures render as "waiting" cards so they're visibly parked. Hidden
  // once a real job/note for the same URL exists (replay succeeded elsewhere).
  const queuedJobs = useMemo<Job[]>(() => {
    if (active !== "all") return [];
    const jobUrls = new Set(jobs.map((j) => j.url));
    const noteUrls = new Set(notes.map((n) => n.source_url));
    return queued
      .filter((q) => !jobUrls.has(q.url) && !noteUrls.has(q.url))
      .map((q) => ({ id: `queued-${q.url}`, url: q.url, status: "pending" }) as Job);
  }, [queued, jobs, notes, active]);

  // Captures parked by the global daily cap (launch-spike protection). They render as a calm
  // "Queued — high demand" card instead of an error, and drain automatically when budget frees.
  const deferredJobs = useMemo<Job[]>(() => {
    if (active !== "all") return [];
    const noteUrls = new Set(notes.map((n) => n.source_url));
    return jobs.filter((j) => j.status === "deferred" && !noteUrls.has(j.url));
  }, [jobs, notes, active]);

  // Failed captures stay visible (with the error) until dismissed or retried — a card
  // that silently disappears reads as data loss.
  const failedJobs = useMemo<Job[]>(() => {
    if (active !== "all") return [];
    return jobs.filter((j) => j.status === "failed" && !dismissedJobs.includes(j.id));
  }, [jobs, dismissedJobs, active]);

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
        <ClipLoader className="h-20 w-20" />
      </div>
    );
  }

  return (
    <NoteMenuProvider categories={categories} collections={collections} uid={user?.uid ?? null}>
      <AppShell>
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 pt-4 pb-3 md:px-8">
            <div className="mb-3 flex items-center justify-between gap-3">
              {/* The Clipnote paper-clip mark + wordmark. */}
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink text-paper">
                  <ClipMark className="h-5 w-5" />
                </span>
                <span className="truncate font-serif text-2xl text-ink">Clipnote</span>
              </div>
              <div className="flex items-center gap-1">
                {/* Free-text search lives on its own route (one search surface, whole corpus). */}
                <Link to="/search" aria-label="Search notes" title="Search" className={ICON_BTN}>
                  <Search className="h-4 w-4" />
                </Link>
                <LayoutToggle layout={layout} setLayout={setLayout} />
                {/* With the bottom tab bar gone, the header is the only nav surface, so
                    Settings lives here on every screen size — now as the user's profile
                    avatar. (Collections is parked for now — no entry point until it returns.) */}
                <SettingsAvatarLink />
              </div>
            </div>

            {/* Shelves already lays the feed out by category, so the chip strip has no
                place there at all — the other layouts keep it as their filter surface. */}
            {categories.length > 0 && layout !== "shelves" && (
              <CategoryChips groups={chipGroups} active={active} setActive={applyActive} />
            )}
          </div>
        </header>

        {/* FAB clearance is handled by the global wrapper padding in __root.tsx. */}
        <main className="mx-auto max-w-7xl px-4 pb-6 pt-5 md:px-8">
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

          {!notesReady && !feedError ? (
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  key={i}
                  className="h-48 animate-pulse rounded-2xl border border-border bg-card"
                />
              ))}
            </section>
          ) : filtered.length === 0 &&
            pendingJobs.length === 0 &&
            failedJobs.length === 0 &&
            deferredJobs.length === 0 &&
            queuedJobs.length === 0 ? (
            showGuide ? null : (
              <EmptyState
                hasNotes={notes.length > 0 || active !== "all"}
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
                      <ProcessingCard key={j.id} job={j} label="Queued, high demand" />
                    ))}
                    {queuedJobs.map((j) => (
                      <ProcessingCard key={j.id} job={j} label="Waiting for connection" />
                    ))}
                    {pendingJobs.map((j) => (
                      <ProcessingCard key={j.id} job={j} />
                    ))}
                  </section>
                ))}

              {layout === "shelves" ? (
                <>
                  {pinnedNotes.length > 0 && (
                    <div>
                      <h2 className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
                        <Pin className="h-3.5 w-3.5" />
                        Pinned
                      </h2>
                      <ShelfRow notes={pinnedNotes} />
                    </div>
                  )}
                  {shelfGroups.map((g) => (
                    <CategoryShelf key={g.label} group={g} />
                  ))}
                </>
              ) : (
                <>
                  {pinnedNotes.length > 0 && (
                    <div>
                      <h2 className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
                        <Pin className="h-3.5 w-3.5" />
                        Pinned
                      </h2>
                      <NotesView notes={pinnedNotes} layout={layout} />
                    </div>
                  )}

                  {dateGroups.map((g) => (
                    <div key={g.key}>
                      <h2 className="mb-3 text-xs uppercase tracking-wider text-ink-soft">
                        {g.label}
                      </h2>
                      <NotesView notes={g.notes} layout={layout} />
                    </div>
                  ))}
                </>
              )}
            </div>
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

        {/* Capture is owned by the global CaptureFab (bottom-right, __root.tsx); the feed's own
            AddNoteSheet below still serves the share-target / deep-link capture flows. */}
        {showAdd && (
          <AddNoteSheet
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
    </NoteMenuProvider>
  );
}

const LAYOUT_OPTIONS = [
  { value: "standard" as const, label: "Cards", icon: LayoutGrid },
  { value: "board" as const, label: "Board", icon: LayoutDashboard },
  { value: "shelves" as const, label: "Shelves", icon: GalleryHorizontalEnd },
  { value: "condensed" as const, label: "Compact", icon: Rows3 },
];

// Header view toggle: a round icon button (same visual language as the other header icons)
// whose glyph reflects the active layout; opens a small dropdown with all three options. Mirrors
// the segmented control in Settings > Appearance — both read/write the same `useLayout` state,
// so picking one here updates that control (and vice versa) without a page reload.
function LayoutToggle({ layout, setLayout }: { layout: Layout; setLayout: (v: Layout) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Right-anchored: on mobile this is the rightmost header icon, so a
    // left-anchored w-44 menu would overflow the viewport edge.
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, [open]);

  const current = LAYOUT_OPTIONS.find((o) => o.value === layout) ?? LAYOUT_OPTIONS[0];
  const CurrentIcon = current.icon;

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change layout"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Layout"
        className={ICON_BTN}
      >
        <CurrentIcon className="h-4 w-4" />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            {/* Full-viewport outside-tap catcher at <body> root: closes the menu AND consumes
                the tap (the portaled menu escapes the header's backdrop-filter stacking
                context, so without this the tap would fall through to a note behind it). */}
            <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => setOpen(false)} />
            <div
              role="listbox"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-[61] w-44 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl"
            >
              {LAYOUT_OPTIONS.map((o) => {
                const isSelected = layout === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setLayout(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "bg-ink/5 text-ink"
                        : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                    }`}
                  >
                    <o.icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{o.label}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-ink" />}
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

// Picks the card layout for a slice of notes. Cards (grid) / Compact (ledger rows) / Board
// (masonry) — one switch so every render site (pinned, each date group, search) stays in step.
function NotesView({ notes, layout }: { notes: Note[]; layout: Layout }) {
  if (layout === "condensed") return <NoteRowList notes={notes} />;
  if (layout === "board") return <BoardMasonry notes={notes} />;
  return <NoteGrid notes={notes} />;
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

// Pinterest-style masonry: CSS multi-column (2 on mobile → 3/4 on wider screens) with
// break-inside-avoid so each image-forward tile stays whole. Column-gap/row-margin start at
// 16px (gap-4) — already comfortable at 2 columns — and open up to 20px (gap-5) once the
// grid reaches 4 columns, since more simultaneous columns read denser and want a touch more
// air to keep the scroll calm rather than tightening the gutter for a busier mosaic. Same
// error-boundary isolation as the grid.
function BoardMasonry({ notes }: { notes: Note[] }) {
  return (
    <section className="columns-2 gap-4 sm:columns-3 lg:columns-4 lg:gap-5 [column-fill:_balance]">
      {notes.map((n) => (
        <div key={n.id} className="mb-4 break-inside-avoid lg:mb-5">
          <ErrorBoundary label="feed-board-card" fallback={<FallbackNoteCard note={n} />}>
            <BoardCard note={n} />
          </ErrorBoundary>
        </div>
      ))}
    </section>
  );
}

// One shelf of the Shelves view: a category header above a horizontally-scrolling strip of
// uniform board tiles. The accent-colored pill (same visual language as the filter chips) is
// a pure label — it deliberately does NOT filter; the only control up here is the chevron,
// which collapses the shelf to just its header. Collapse is per-mount UI state, not persisted.
function CategoryShelf({ group }: { group: CategoryGroup }) {
  const slug = group.slugs[0];
  const accent = noteAccent(slug);
  const Icon = noteIcon(slug);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2
          className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${accent.chip}`}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{group.label}</span>
        </h2>
        <span className="text-[11px] tabular-nums text-ink-soft/60">{group.notes.length}</span>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
          className={`rounded-full p-1 text-ink-soft/60 transition-colors hover:text-ink ${FOCUS_RING}`}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        </button>
      </div>
      {!collapsed && <ShelfRow notes={group.notes} />}
    </div>
  );
}

// The horizontal strip itself: snap-scrolling, scrollbar hidden, bleeding to the viewport
// edge (negative margins mirror <main>'s px-4/md:px-8 padding) so a half-visible tile at
// the edge advertises that the row scrolls. Fixed tile width + the fixed 4:5 portrait cover
// keeps every card in the strip the same footprint, and portrait (most saved covers are
// vertical video thumbnails) shows far more of the image than a square crop did. The shelf
// header already names the category, so tiles drop their own category line ("hideCategory").
// Same error-boundary isolation as the grid.
function ShelfRow({ notes }: { notes: Note[] }) {
  return (
    <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:-mx-8 md:px-8">
      {notes.map((n) => (
        <div key={n.id} className="w-40 shrink-0 snap-start sm:w-56">
          <ErrorBoundary label="feed-shelf-card" fallback={<FallbackNoteCard note={n} />}>
            <BoardCard note={n} ratio={4 / 5} hideCategory />
          </ErrorBoundary>
        </div>
      ))}
    </div>
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
          : "Tap + to clip your first link, or see one in action."}
      </p>
      {!hasNotes && onTrySample && (
        <PillButton type="button" onClick={onTrySample} className="mt-5">
          <WandSparkles className="h-4 w-4" />
          Try a sample note
        </PillButton>
      )}
    </div>
  );
}
