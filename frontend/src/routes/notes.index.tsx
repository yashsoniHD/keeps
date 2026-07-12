import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import {
  Search,
  Sparkles,
  Sparkle,
  Plus,
  WandSparkles,
  AlertCircle,
  X,
  Check,
  Layers,
  Link2,
  AlignLeft,
  ImagePlus,
  Mic,
  ArrowLeft,
  Pin,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useAsk } from "@/contexts/ask-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import {
  watchNotes,
  watchPendingJobs,
  watchCollections,
  getUserCategories,
  getUserSources,
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
import { groupNotesByDate, noteLabel, sourceLabel } from "@/lib/note-meta";
import { setFeedOrder } from "@/lib/note-nav";
import { getCached, hasCached, setCached } from "@/lib/swr-cache";
import { FOCUS_RING } from "@/lib/ui";
import { PillButton } from "@/components/shared/PillButton";
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
import { CategoryChips, CollectionsMenu } from "@/components/feed/CategoryFilter";
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

// A source-filter option: either a web domain (rendered with its favicon) or a synthetic
// "manual" group for captures that have no web source (typed/voice/uploaded/Clip-AI notes),
// rendered with a lucide icon. `id` is what `source` filter state holds.
type SourceOption = { id: string; label: string; domain?: string; icon?: LucideIcon };

// Manual capture groups, keyed by a `manual:*` id (see noteMatchesSource). Shown only when
// the loaded feed actually contains a matching note, so the filter never lists empty buckets.
const MANUAL_SOURCES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "manual:text", label: "Written", icon: AlignLeft },
  { id: "manual:voice", label: "Voice notes", icon: Mic },
  { id: "manual:upload", label: "Uploads", icon: ImagePlus },
  { id: "manual:ai", label: "Clip AI", icon: Sparkle },
];

// True if a note belongs to the selected source. Web sources match on domain; the synthetic
// `manual:*` groups match on how the note was captured (Clip-AI provenance wins over its
// input_type so an AI-authored text note lands under "Clip AI", not "Written").
function noteMatchesSource(n: Note, source: string): boolean {
  if (source === "all") return true;
  if (source === "manual:ai") return n.source === "ai";
  if (source === "manual:text") return n.source !== "ai" && n.input_type === "text";
  if (source === "manual:voice") return n.input_type === "voice";
  if (source === "manual:upload")
    return n.input_type === "image" || n.input_type === "pdf" || n.input_type === "video";
  return n.source_domain === source;
}

// Which manual groups have at least one note in the loaded feed.
function presentManualSources(notes: Note[]): Set<string> {
  const present = new Set<string>();
  for (const n of notes) {
    for (const g of MANUAL_SOURCES) {
      if (!present.has(g.id) && noteMatchesSource(n, g.id)) present.add(g.id);
    }
  }
  return present;
}

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
  const [userSources, setUserSources] = useState<string[]>([]);
  const [active, setActive] = useState<string>(typeParam ?? "all");
  const [source, setSource] = useState<string>("all");
  // Read-only here — the view toggle (Cards / Board / Compact) lives in Settings (Appearance).
  // The hook keeps this in sync via localStorage, so changing it there reflects immediately.
  const [layout] = useLayout();
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
    getUserSources(user.uid)
      .then(setUserSources)
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

  // Web-source domains come from users/{uid}.sources (whole-corpus source of truth) unioned
  // with loaded notes, so the filter doesn't vanish when a server-side category filter
  // narrows the loaded notes to one domain — same trick as the category chips above. Empty
  // domains (manual captures) are dropped here and surfaced as the manual groups below.
  const domainSources = useMemo(
    () =>
      Array.from(new Set([...userSources, ...notes.map((n) => n.source_domain)]))
        .filter(Boolean)
        .sort(),
    [notes, userSources],
  );
  // The full ordered option list for the source filter: web domains first, then any manual
  // capture groups present in the feed (Written / Voice / Uploads / Clip AI).
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const present = presentManualSources(notes);
    return [
      ...domainSources.map((d) => ({ id: d, label: sourceLabel(d), domain: d })),
      ...MANUAL_SOURCES.filter((g) => present.has(g.id)).map((g) => ({
        id: g.id,
        label: g.label,
        icon: g.icon,
      })),
    ];
  }, [domainSources, notes]);

  // Browse view: the live feed filtered only by the type/source chips. Free-text search now
  // lives on its own route (/search) over the whole corpus, so the feed no longer filters by
  // a query — it's purely the chip-filtered stream.
  const filtered = useMemo(() => {
    return notes.filter((n) => {
      // Home is THE feed — every note streams here regardless of collection. The /notes
      // deep link stays the catch-all: notes filed into a smart collection live in that
      // collection, not there. Excluded client-side so it works regardless of whether older
      // notes have the collection_id field yet (a Firestore `== null` query would miss those).
      if (!home && n.collection_id) return false;
      if (activeSlugs && !activeSlugs.includes(n.content_type)) return false;
      if (!noteMatchesSource(n, source)) return false;
      return true;
    });
  }, [notes, activeSlugs, source, home]);

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

  // Persist the visible order (pinned first, then the date-grouped stream — matching what's on
  // screen) so the note view can swipe/arrow to the next note in the same filtered context.
  useEffect(() => {
    setFeedOrder([
      ...pinnedNotes.map((n) => n.id),
      ...filtered.filter((n) => !n.pinned_at).map((n) => n.id),
    ]);
  }, [filtered, pinnedNotes]);

  // Processing cards show only on the default view — an in-flight job has no type/title
  // yet to match a filter or search. Merge server jobs with not-yet-acknowledged local
  // placeholders, drop any whose note already landed (the brief completion overlap).
  const pendingJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all") return [];
    const inflight = jobs.filter((j) => j.status === "pending" || j.status === "processing");
    const noteUrls = new Set(notes.map((n) => n.source_url));
    const jobUrls = new Set(jobs.map((j) => j.url));
    const placeholders = optimistic
      .filter((o) => !jobUrls.has(o.url) && !noteUrls.has(o.url))
      .map((o) => ({ id: o.id, url: o.url, status: "pending" }) as Job);
    return [...placeholders, ...inflight.filter((j) => !noteUrls.has(j.url))];
  }, [jobs, optimistic, notes, active, source]);

  // Offline-held captures render as "waiting" cards so they're visibly parked. Hidden
  // once a real job/note for the same URL exists (replay succeeded elsewhere).
  const queuedJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all") return [];
    const jobUrls = new Set(jobs.map((j) => j.url));
    const noteUrls = new Set(notes.map((n) => n.source_url));
    return queued
      .filter((q) => !jobUrls.has(q.url) && !noteUrls.has(q.url))
      .map((q) => ({ id: `queued-${q.url}`, url: q.url, status: "pending" }) as Job);
  }, [queued, jobs, notes, active, source]);

  // Captures parked by the global daily cap (launch-spike protection). They render as a calm
  // "Queued — high demand" card instead of an error, and drain automatically when budget frees.
  const deferredJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all") return [];
    const noteUrls = new Set(notes.map((n) => n.source_url));
    return jobs.filter((j) => j.status === "deferred" && !noteUrls.has(j.url));
  }, [jobs, notes, active, source]);

  // Failed captures stay visible (with the error) until dismissed or retried — a card
  // that silently disappears reads as data loss.
  const failedJobs = useMemo<Job[]>(() => {
    if (active !== "all" || source !== "all") return [];
    return jobs.filter((j) => j.status === "failed" && !dismissedJobs.includes(j.id));
  }, [jobs, dismissedJobs, active, source]);

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
                <CollectionsMenu />
                <Link to="/settings" aria-label="Settings" title="Settings" className={ICON_BTN}>
                  <SettingsIcon className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {(categories.length > 0 || sourceOptions.length > 1) && (
              <div className="flex items-center gap-2">
                {sourceOptions.length > 1 && (
                  <SourceFilter options={sourceOptions} source={source} setSource={setSource} />
                )}
                <CategoryChips groups={chipGroups} active={active} setActive={applyActive} />
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-6 pt-5 md:pb-28 md:px-8">
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
                hasNotes={notes.length > 0 || active !== "all" || source !== "all"}
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
                  <h2 className="mb-3 text-xs uppercase tracking-wider text-ink-soft">{g.label}</h2>
                  <NotesView notes={g.notes} layout={layout} />
                </div>
              ))}
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

        {/* Primary action FAB: capture a new note. Desktop only — on mobile the bottom tab bar's
            center + button owns capture (BottomNav). Sits above the global Ask launcher pill
            (AskFab, bottom-right) so the two right-corner controls stack instead of overlapping. */}
        <button
          type="button"
          onClick={() => {
            setPendingUrl("");
            setShowAdd(true);
          }}
          aria-label="New note"
          title="New note"
          className="fixed bottom-24 right-6 z-40 hidden h-14 w-14 items-center justify-center rounded-full bg-ink text-paper shadow-xl transition-transform active:scale-95 md:flex"
        >
          <Plus className="h-6 w-6" />
        </button>

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

// Source filter: a custom dropdown (native <select> can't render logos) showing each web
// platform's favicon — or, for manual captures, a lucide icon — beside its name. Manual
// notes (typed/voice/uploaded/Clip-AI) have no web source, so they'd otherwise collapse
// into a single label-less "?" favicon; the synthetic groups give them real entries.
function SourceFilter({
  options,
  source,
  setSource,
}: {
  options: SourceOption[];
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

  const allOptions: SourceOption[] = [
    { id: "all", label: "All sources", icon: Layers },
    ...options,
  ];
  const selected = options.find((o) => o.id === source);

  // The glyph for an option: its favicon if it's a web domain, otherwise its lucide icon.
  const Glyph = ({ option, className }: { option: SourceOption; className?: string }) =>
    option.domain ? (
      <SourceLogo domain={option.domain} className={`${className} rounded`} />
    ) : option.icon ? (
      <option.icon className={className} />
    ) : (
      <Layers className={className} />
    );

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
          selected
            ? "border-ink bg-card text-ink"
            : "border-border bg-card text-ink-soft hover:text-ink"
        }`}
      >
        {selected ? (
          <Glyph option={selected} className="h-5 w-5" />
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
              {allOptions.map((o) => {
                const isSelected = source === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setSource(o.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm capitalize transition-colors ${
                      isSelected
                        ? "bg-ink/5 text-ink"
                        : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                    }`}
                  >
                    <Glyph option={o} className="h-5 w-5 shrink-0 text-ink-soft" />
                    <span className="flex-1 truncate">{o.label}</span>
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
// break-inside-avoid so each image-forward tile stays whole. Column-gap comes from `gap-4`;
// row spacing from the matching item margin — a touch more air than the tiles' own p-3 so
// the phone grid doesn't read as cramped. Same error-boundary isolation as the grid.
function BoardMasonry({ notes }: { notes: Note[] }) {
  return (
    <section className="columns-2 gap-4 sm:columns-3 lg:columns-4 [column-fill:_balance]">
      {notes.map((n) => (
        <div key={n.id} className="mb-4 break-inside-avoid">
          <ErrorBoundary label="feed-board-card" fallback={<FallbackNoteCard note={n} />}>
            <BoardCard note={n} />
          </ErrorBoundary>
        </div>
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
