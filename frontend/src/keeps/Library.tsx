import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/contexts/auth-context";
import {
  getOnboardingDone,
  getUserCategories,
  setOnboardingDone,
  watchNotes,
  watchPendingJobs,
} from "@/lib/firestore";
import { analytics } from "@/lib/analytics";
import { noteAccent, noteIcon, noteLabel } from "@/lib/note-meta";
import { setFeedOrder } from "@/lib/note-nav";
import { getCached, hasCached, setCached } from "@/lib/swr-cache";
import { useCapture } from "@/components/CaptureProvider";
import type { Job, Note } from "@/lib/types";
import { EmptyState, Icon, IconButton, Logo, NoteRow } from "./ui";
import { NoteActions } from "./NoteActions";
import { Guide } from "./Guide";
import { primeNotes } from "./noteCache";
import { toView } from "./toView";
import type { NoteView } from "./view";

// The Keeps library: the live, category-filtered stream of the user's notes, with in-flight
// captures (processing / queued / failed) at the top.

// First-run "try a sample" link: reaches the aha (a real, structured note) in one tap.
// A recipe page with JSON-LD makes the most striking first note; verify it still resolves.
const SAMPLE_LINK = "https://www.bbcgoodfood.com/recipes/best-ever-chocolate-brownies-recipe";
const PAGE = 50;

const MemoRow = memo(NoteRow);

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// iOS only opens the keyboard for focus() inside a user gesture. Focus a throwaway input now; the
// search page's autoFocus input takes over after navigation, keeping the keyboard up.
function primeKeyboard() {
  const el = document.createElement("input");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  el.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;width:1px;height:1px";
  document.body.appendChild(el);
  el.focus();
  setTimeout(() => el.remove(), 1000);
}

type RowKind = "processing" | "queued" | "waiting" | "failed";

// A not-yet-a-note row: same silhouette as NoteRow, status copy instead of a summary.
function JobRow({
  kind,
  url,
  error,
  onRetry,
  onDismiss,
}: {
  kind: RowKind;
  url: string;
  error?: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const title =
    kind === "failed"
      ? "Couldn’t create this note"
      : kind === "queued"
        ? "Queued, high demand"
        : kind === "waiting"
          ? "Waiting to retry"
          : "Extracting the useful bits";
  const body =
    kind === "failed"
      ? error || "Something went wrong. Retry to try again."
      : kind === "queued"
        ? "We’re busy right now. Your link is saved and will start soon."
        : kind === "waiting"
          ? "We couldn’t reach Keeps. This link will save automatically when we can."
          : "Your link is saved. We’ll take it from here.";
  return (
    <article className="note-row job-row">
      <div className="note-open">
        <div className="thumbnail">
          <Icon
            name={kind === "failed" ? "HelpCircle" : kind === "waiting" ? "WifiOff" : "Loader2"}
            size={28}
            className={kind === "processing" || kind === "queued" ? "spin" : undefined}
          />
        </div>
        <div className="note-copy">
          <h3 className="status-title">{title}</h3>
          <p>{body}</p>
          <div className="note-meta">
            <span className="note-age">{host(url)}</span>
          </div>
        </div>
      </div>
      {onRetry && (
        <button type="button" className="text-button" onClick={onRetry}>
          Retry
        </button>
      )}
      {onDismiss && <IconButton icon="X" label="Dismiss" onClick={onDismiss} />}
    </article>
  );
}

export function Library({ typeParam }: { typeParam?: string }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { openCapture, capture, optimistic, queued, settle, refreshQueue } = useCapture();
  // Seed from the SWR cache so back-navigation renders the last-seen feed instantly; the live
  // listener below revalidates. Keys are uid-scoped and carry the active type.
  const [notes, setNotes] = useState<Note[]>(() =>
    user ? (getCached<Note[]>(`feed:${user.uid}:${typeParam ?? "all"}`) ?? []) : [],
  );
  const [notesReady, setNotesReady] = useState(() =>
    user ? hasCached(`feed:${user.uid}:${typeParam ?? "all"}`) : false,
  );
  const [feedError, setFeedError] = useState(false);
  const [max, setMax] = useState(PAGE);
  const [userCategories, setUserCategories] = useState<string[]>([]);
  const [active, setActive] = useState<string>(typeParam ?? "all");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dismissedJobs, setDismissedJobs] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("keeps.dismissedJobs") || "[]");
    } catch {
      return [];
    }
  });
  const [showGuide, setShowGuide] = useState(false);
  const [actionsFor, setActionsFor] = useState<NoteView | null>(null);
  // Sticky header gets a divider only once the page has scrolled (sentinel leaves the viewport).
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [loading, user]);

  // Pick up captures queued while away (e.g. from the share page) and retry them.
  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  // Logged-out visitors go straight to sign-in.
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Chip groups: different slugs can share a display label (itinerary + trip -> "Trips").
  // One chip per label carrying ALL its slugs, sorted by label. Source: user doc + loaded notes.
  // Only slugs that have notes: on a complete "All" view (not truncated) the loaded notes are the
  // truth; when truncated the user doc is added (can't know). The last "All" set is remembered so
  // chips survive a narrowing filter, and the active slug always stays (deep links).
  const [allSlugs, setAllSlugs] = useState<string[] | null>(null);
  useEffect(() => {
    if (active !== "all" || !notesReady) return;
    const s = new Set(notes.map((n) => n.content_type));
    if (notes.length >= max) userCategories.forEach((c) => s.add(c));
    setAllSlugs(Array.from(s));
  }, [active, notesReady, notes, max, userCategories]);
  const chipGroups = useMemo(() => {
    const slugs = new Set(allSlugs ?? [...userCategories, ...notes.map((n) => n.content_type)]);
    if (active !== "all") slugs.add(active);
    const byLabel = new Map<string, string[]>();
    for (const slug of Array.from(slugs).sort()) {
      const label = noteLabel(slug);
      const arr = byLabel.get(label);
      if (arr) arr.push(slug);
      else byLabel.set(label, [slug]);
    }
    return Array.from(byLabel.entries())
      .map(([label, s]) => ({ label, slugs: s.slice().sort() }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [notes, userCategories, allSlugs, active]);
  // The slug set the active chip filters by (null == All). `activeKey` is the stable string the
  // subscription keys off, so streaming notes don't churn the listener.
  const activeSlugs = useMemo<string[] | null>(() => {
    if (active === "all") return null;
    return chipGroups.find((g) => g.slugs.includes(active))?.slugs ?? [active];
  }, [active, chipGroups]);
  const activeKey = activeSlugs ? activeSlugs.join(",") : "all";

  // Real-time feed. The category filter runs server-side (composite index, Firestore `in` for
  // multi-slug chips), so it sees past the feed window.
  useEffect(() => {
    if (!user) return;
    const types = activeKey === "all" ? undefined : activeKey.split(",");
    return watchNotes(
      user.uid,
      (n) => {
        setNotes(n);
        primeNotes(n);
        setNotesReady(true);
        setFeedError(false);
        // Cache under the raw selected slug: the initial read looks up `feed:{uid}:{typeParam}`.
        setCached(`feed:${user.uid}:${active}`, n);
      },
      { max, contentType: types, onError: () => setFeedError(true) },
    );
  }, [user, max, active, activeKey]);

  // users/{uid}.categories is the chip source of truth, so chips survive a narrowing filter.
  useEffect(() => {
    if (!user) return;
    getUserCategories(user.uid)
      .then(setUserCategories)
      .catch(() => {});
  }, [user]);

  // In-flight captures (works for every capture path).
  useEffect(() => {
    if (!user) return;
    return watchPendingJobs(user.uid, setJobs);
  }, [user]);

  // Follow a `?type=` deep link (and clearing it) into the chip filter.
  useEffect(() => {
    setActive(typeParam ?? "all");
  }, [typeParam]);

  // Set the active category AND mirror it into the URL (?type=...) so Back from a note returns
  // to the same category. `replace` keeps it out of history.
  const applyActive = useCallback(
    (v: string) => {
      setActive(v);
      navigate({ to: "/", search: v === "all" ? {} : { type: v }, replace: true });
    },
    [navigate],
  );

  // Getting-started guide: shown until users/{uid}.onboarding_done (cross-device); the
  // localStorage mirror prevents a flash of the guide on every load after dismissal.
  useEffect(() => {
    if (!user || localStorage.getItem("keeps.onboardingDone") === "1") return;
    getOnboardingDone(user.uid)
      .then((done) => {
        if (done) localStorage.setItem("keeps.onboardingDone", "1");
        else setShowGuide(true);
      })
      .catch(() => {});
  }, [user]);

  const dismissGuide = () => {
    setShowGuide(false);
    try {
      localStorage.setItem("keeps.onboardingDone", "1");
    } catch {
      /* mirror only — the Firestore flag below is the durable copy */
    }
    if (user) setOnboardingDone(user.uid).catch(() => {});
  };

  // Retire each local placeholder once its real job (same url) or finished note arrives.
  useEffect(() => {
    settle(new Set([...jobs.map((j) => j.url), ...notes.map((n) => n.source_url)]));
  }, [jobs, notes, settle]);

  // Funnel signals: a per-day "returned" visit, and activation the moment a first note renders.
  useEffect(() => {
    if (user) analytics.returned();
  }, [user]);
  useEffect(() => {
    if (notes.length > 0) analytics.activated();
  }, [notes.length]);

  const filtered = useMemo(
    () => (activeSlugs ? notes.filter((n) => activeSlugs.includes(n.content_type)) : notes),
    [notes, activeSlugs],
  );
  const views = useMemo(() => filtered.map(toView), [filtered]);

  // Visible order, so the note view can swipe/arrow to the next note in the same context.
  useEffect(() => {
    setFeedOrder(filtered.map((n) => n.id));
  }, [filtered]);

  // Pending rows show only on the "All" view — an in-flight job has no type/title yet to match
  // a filter. Drop any whose note already landed (the brief completion overlap).
  const pending = useMemo(() => {
    if (active !== "all")
      return { rows: [] as { key: string; kind: RowKind; url: string }[], failed: [] as Job[] };
    const noteUrls = new Set(notes.map((n) => n.source_url));
    const jobUrls = new Set(jobs.map((j) => j.url));
    const rows: { key: string; kind: RowKind; url: string }[] = [];
    for (const o of optimistic)
      if (!jobUrls.has(o.url) && !noteUrls.has(o.url))
        rows.push({ key: o.id, kind: "processing", url: o.url });
    for (const q of queued)
      if (!jobUrls.has(q.url) && !noteUrls.has(q.url))
        rows.push({ key: `queued-${q.url}`, kind: "waiting", url: q.url });
    for (const j of jobs) {
      if (noteUrls.has(j.url)) continue;
      if (j.status === "deferred") rows.push({ key: j.id, kind: "queued", url: j.url });
      else if (j.status === "pending" || j.status === "processing")
        rows.push({ key: j.id, kind: "processing", url: j.url });
    }
    // Failed captures stay visible (with the error) until dismissed or retried — a row that
    // silently disappears reads as data loss.
    const failed = jobs.filter((j) => j.status === "failed" && !dismissedJobs.includes(j.id));
    return { rows, failed };
  }, [active, jobs, optimistic, queued, notes, dismissedJobs]);

  const dismissJob = (jobId: string) =>
    setDismissedJobs((prev) => {
      const next = [...prev.filter((id) => id !== jobId), jobId].slice(-100);
      try {
        localStorage.setItem("keeps.dismissedJobs", JSON.stringify(next));
      } catch {
        /* in-memory dismissal still applies this session */
      }
      return next;
    });
  const retryJob = (job: Job) => {
    dismissJob(job.id);
    capture(job.url);
  };

  const openNote = useCallback(
    (v: NoteView) => navigate({ to: "/notes/$noteId", params: { noteId: v.id } }),
    [navigate],
  );
  const openActions = useCallback((v: NoteView) => setActionsFor(v), []);

  if (loading || !user) return null;

  const avatarText = initials(user.displayName);
  const pendingCount = pending.rows.length + pending.failed.length;
  const empty = views.length === 0 && pendingCount === 0;

  return (
    <div className="app-shell">
      <main id="main-content" tabIndex={-1} className="main">
        <div ref={sentinel} className="sticky-sentinel" aria-hidden="true" />
        <div className={`sticky-top${scrolled ? " scrolled" : ""}`}>
          <header className="page-header">
            <div>
              <button
                type="button"
                className="app-title"
                aria-label="Keeps home"
                onClick={() => applyActive("all")}
              >
                <Logo />
              </button>
            </div>
            <div className="header-actions">
              <IconButton
                icon="Search"
                label="Search saved notes"
                onClick={() => {
                  primeKeyboard();
                  navigate({ to: "/search" });
                }}
              />
              <IconButton icon="Plus" label="Save a link" onClick={openCapture} />
              <button
                type="button"
                className="avatar"
                aria-label="Open profile and settings"
                onClick={() => navigate({ to: "/settings" })}
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
                ) : (
                  avatarText || <Icon name="Settings" size={18} />
                )}
              </button>
            </div>
          </header>

          {/* Rendered before notes arrive (just "All") so the strip never pops in and shifts the list. */}
          {(!notesReady || chipGroups.length > 0) && (
            <div className="filter-chips" aria-label="Filter by category">
              <button
                type="button"
                aria-pressed={active === "all"}
                className={active === "all" ? "selected" : ""}
                onClick={() => applyActive("all")}
              >
                <Icon name="Bookmark" size={15} />
                All
              </button>
              {chipGroups.map((g) => {
                const selected = g.slugs.includes(active);
                const CategoryIcon = noteIcon(g.slugs[0]);
                const accent = noteAccent(g.slugs[0]);
                return (
                  <button
                    key={g.label}
                    type="button"
                    data-category={g.label}
                    aria-pressed={selected}
                    onClick={() => applyActive(g.slugs[0])}
                  >
                    <span className={`chip-face ${selected ? `on ${accent.chip}` : ""}`}>
                      <CategoryIcon
                        size={14}
                        strokeWidth={1.65}
                        aria-hidden="true"
                        className={selected ? undefined : accent.text}
                      />
                      {g.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <section className="library" aria-label="Saved links">
          {feedError && (
            <p className="library-alert" role="alert">
              Couldn’t load your notes. Check your connection and refresh.
            </p>
          )}

          {notesReady && showGuide && (
            <Guide
              notesCount={notes.length}
              onAddLink={openCapture}
              onTrySample={() => capture(SAMPLE_LINK)}
              onDismiss={dismissGuide}
            />
          )}

          {!notesReady && !feedError ? (
            <div className="note-list library-list" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="note-row skeleton-row" />
              ))}
            </div>
          ) : empty ? (
            showGuide ? null : (
              <EmptyState
                title={active !== "all" ? "No saves in this category" : "Your library starts here"}
                description="Tap + to save a link you want to come back to."
              >
                {active === "all" && (
                  <button type="button" className="primary" onClick={() => capture(SAMPLE_LINK)}>
                    Try a sample note
                  </button>
                )}
                <button type="button" className="text-button" onClick={openCapture}>
                  Paste a link
                </button>
              </EmptyState>
            )
          ) : (
            <>
              <div className="note-list library-list">
                {pending.failed.map((j) => (
                  <JobRow
                    key={j.id}
                    kind="failed"
                    url={j.url}
                    error={j.error}
                    onRetry={() => retryJob(j)}
                    onDismiss={() => dismissJob(j.id)}
                  />
                ))}
                {pending.rows.map((r) => (
                  <JobRow key={r.key} kind={r.kind} url={r.url} />
                ))}
                {views.map((v) => (
                  <MemoRow key={v.id} note={v} onOpen={openNote} onActions={openActions} />
                ))}
                {notesReady && notes.length >= max && (
                  <button
                    type="button"
                    className="secondary load-more"
                    onClick={() => setMax((m) => m + PAGE)}
                  >
                    Show more saves
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </main>
      {actionsFor && <NoteActions view={actionsFor} onClose={() => setActionsFor(null)} />}
    </div>
  );
}
