import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Camera,
  Clock,
  FolderPlus,
  Library as LibraryIcon,
  Link2,
  Mic,
  PenLine,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import {
  watchCollections,
  watchFavorites,
  watchRecent,
  getManualNotesCount,
  getToolCounts,
  type ToolCounts,
} from "@/lib/firestore";
import { NewCollectionSheet } from "@/components/library/NewCollectionSheet";
import { goToHit } from "@/lib/nav";
import { formatDateShort, iconByName, paletteAccent } from "@/lib/note-meta";
import { TOOLS, toolByApp } from "@/lib/collections-meta";
import { FOCUS_RING } from "@/lib/ui";
import { AppShell, useCapture } from "@/components/AppShell";
import type { Collection, SearchHit } from "@/lib/types";

// The Library is the home: everything the user saves is a collection — the app-backed tools
// (Watchlist, Recipes, …), the Notes catch-all, virtual folders (Favorites, Your notes), and
// their own smart collections — followed by a list of the most recent saves.
export const Route = createFileRoute("/")({ component: LibraryHome });

const ICON_BTN = `inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`;

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-soft">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </h2>
  );
}

// A collection card: a soft wash of the collection's domain color, a saturated icon chip,
// serif name, and a color-matched count. Every collection — tool, folder, or smart bucket —
// wears this shape; only the hue changes, so the grid reads as one colorful family.
function CollectionTile({
  to,
  icon: Icon,
  wash,
  chip,
  countClass,
  name,
  sub,
  count,
}: {
  to: string;
  icon: LucideIcon;
  wash: string; // tile surface, e.g. "border-media/15 bg-media-soft"
  chip: string; // saturated icon square, e.g. "bg-media text-white"
  countClass: string; // colored count, e.g. "text-media"
  name: string;
  sub: string;
  count?: number;
}) {
  return (
    <Link
      to={to}
      className={`press ${FOCUS_RING} group relative flex h-28 flex-col justify-between overflow-hidden rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md sm:h-32 ${wash}`}
    >
      {/* Oversized watermark bleeding off the corner — each collection's icon as its texture,
          so the grid reads as nine distinct objects instead of nine pastel rectangles. */}
      <Icon
        aria-hidden
        className={`absolute -bottom-4 -right-4 h-20 w-20 opacity-[0.09] transition-transform duration-300 group-hover:scale-110 sm:h-24 sm:w-24 ${countClass}`}
      />
      <div className="relative flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-sm ${chip}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        {count !== undefined && count > 0 && (
          <span className={`text-sm font-medium tabular-nums ${countClass}`}>{count}</span>
        )}
      </div>
      <span className="relative min-w-0">
        <span className="block truncate font-serif text-[1.375rem] leading-tight text-ink">
          {name}
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-soft">{sub}</span>
      </span>
    </Link>
  );
}

// One recent save, read from the search_index (one row per surviving note/item). Shows the real
// title + a summary snippet + cover thumbnail, and routes reliably via `app`/`ref_id` — no dead
// clicks on since-deleted notes, no bare URLs.
function RecentSaveRow({ hit, onOpen }: { hit: SearchHit; onOpen: () => void }) {
  const tool = toolByApp(hit.app); // always resolves (Notes for plain notes)
  const FallbackIcon = tool.icon;
  const summary = hit.summary?.trim();

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 ${FOCUS_RING}`}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
        {hit.cover_image_url ? (
          <img
            src={hit.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className={`flex h-full w-full items-center justify-center ${tool.soft}`}>
            <FallbackIcon className="h-4.5 w-4.5" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {hit.title || "Untitled"}
        </span>
        {summary && <span className="mt-0.5 block truncate text-xs text-ink-soft">{summary}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {hit.app && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tool.soft}`}>
            {tool.label}
          </span>
        )}
        <span className="text-[11px] tabular-nums text-ink-soft">
          {formatDateShort(hit.created_at)}
        </span>
      </span>
    </button>
  );
}

// "Create a collection" tile — opens the full creation sheet (name + description + icon/colour),
// which awaits the backfill sweep and reports what it filed in. The old inline name-only input
// created silent, empty, gray collections; the sheet is the fix.
function NewCollectionTile({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`press flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card/40 text-ink-soft transition-colors hover:border-ink/30 hover:text-ink sm:h-32 ${FOCUS_RING}`}
      >
        <FolderPlus className="h-5 w-5" />
        <span className="text-sm font-medium">New collection</span>
      </button>
      {open && <NewCollectionSheet uid={uid} onClose={() => setOpen(false)} />}
    </>
  );
}

// Quick-action chips under the hero composer — each opens the capture sheet pre-armed for
// its input type, wearing a different domain tint so the row reads as a colorful invitation.
const QUICK_ACTIONS: Array<{
  mode: "link" | "text" | "file" | "voice";
  icon: LucideIcon;
  label: string;
  tint: string;
}> = [
  { mode: "link", icon: Link2, label: "Link", tint: "bg-tech-soft text-tech" },
  { mode: "text", icon: PenLine, label: "Note", tint: "bg-summary-soft text-summary" },
  { mode: "file", icon: Camera, label: "Photo", tint: "bg-place-soft text-place" },
  { mode: "voice", icon: Mic, label: "Voice", tint: "bg-health-soft text-health" },
];

function greetingForHour(h: number): string {
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// The home content — a child of AppShell so it can trigger the shell-owned capture flow.
function LibraryHomeContent({ uid }: { uid: string }) {
  useCategoryMeta(); // reflect category icon/colour overrides on collection tiles
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openCapture } = useCapture();
  const [favorites, setFavorites] = useState(0);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [manualCount, setManualCount] = useState(0);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [counts, setCounts] = useState<ToolCounts>({});
  // A listener failure must be visible — silently swallowing it makes a broken load look
  // like an empty library. One banner covers all the home listeners; retry resubscribes.
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoadError(false);
    const onError = () => setLoadError(true);
    const unsubFav = watchFavorites(uid, (n) => setFavorites(n.length), { onError });
    const unsubCol = watchCollections(uid, setCollections, { onError });
    const unsubRecent = watchRecent(uid, setRecent, { max: 6, onError });
    // "Your notes" needs only a number — a server-side aggregate, not 200 streamed docs.
    getManualNotesCount(uid)
      .then(setManualCount)
      .catch(() => {}); // cosmetic count — the tile just stays hidden
    getToolCounts(uid)
      .then(setCounts)
      .catch(onError);
    return () => {
      unsubFav();
      unsubCol();
      unsubRecent();
    };
  }, [uid, attempt]);

  // Virtual folders (Favorites / Your notes) sit alongside real collections. Empty ones hide.
  const folders = useMemo(() => {
    const out: Array<{
      id: string;
      icon: LucideIcon;
      wash: string;
      chip: string;
      countClass: string;
      name: string;
      count?: number;
    }> = [];
    if (favorites > 0)
      out.push({
        id: "favorites",
        icon: Star,
        wash: "border-favorite/20 bg-favorite-soft",
        chip: "bg-favorite text-white",
        countClass: "text-favorite",
        name: "Favorites",
        count: favorites,
      });
    if (manualCount > 0)
      out.push({
        id: "manual",
        icon: PenLine,
        wash: "border-border bg-secondary/70",
        chip: "bg-ink text-paper",
        countClass: "text-ink-soft",
        name: "Your notes",
        count: manualCount,
      });
    for (const c of collections) {
      const accent = c.palette != null ? paletteAccent(c.palette) : null;
      out.push({
        id: c.id,
        icon: iconByName(c.icon) ?? FolderPlus,
        wash: accent ? accent.wash : "border-border bg-secondary/70",
        chip: accent ? `${accent.dot} text-white` : "bg-ink text-paper",
        countClass: accent ? accent.text : "text-ink-soft",
        name: c.name,
      });
    }
    return out;
  }, [favorites, manualCount, collections]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink text-paper">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-serif text-2xl text-ink">Clipnote</span>
          </div>
          <div className="flex items-center gap-1">
            <Link to="/search" aria-label="Search" title="Search" className={ICON_BTN}>
              <Search className="h-4 w-4" />
            </Link>
            {/* Capture lives in the header — the one filled button in the row, always a tap away. */}
            <button
              type="button"
              onClick={() => openCapture()}
              aria-label="Save anything"
              title="Save anything"
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink text-paper shadow-sm transition-transform hover:scale-105 active:scale-95 ${FOCUS_RING}`}
            >
              <Plus className="h-4.5 w-4.5" />
            </button>
            <Link to="/settings" aria-label="Settings" title="Settings" className={ICON_BTN}>
              <Settings className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-9 px-4 py-6 md:px-8 md:py-8">
        {loadError && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-ink">
            <span>Couldn’t load part of your library.</span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className={`rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper ${FOCUS_RING}`}
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setLoadError(false)}
                aria-label="Dismiss"
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:text-ink ${FOCUS_RING}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Greeting + capture: an editorial opening line, then one slim row of tinted
            quick-capture chips. The "+" itself lives in the header. */}
        <section>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-soft">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h1 className="mt-1 font-serif text-3xl leading-tight text-ink">
            {greetingForHour(new Date().getHours())}
            {user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}
          </h1>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.mode}
                type="button"
                onClick={() => openCapture(undefined, a.mode)}
                className={`press flex items-center justify-center gap-1.5 rounded-full px-2 py-2.5 text-sm font-medium shadow-sm ${a.tint} ${FOCUS_RING}`}
              >
                <a.icon className="h-4 w-4" />
                {a.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle icon={LibraryIcon}>Collections</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {TOOLS.map((t) => (
              <CollectionTile
                key={t.key}
                to={t.to}
                icon={t.icon}
                wash={t.wash}
                chip={t.fill}
                countClass={t.text}
                name={t.label}
                sub={t.desc}
                count={counts[t.key]}
              />
            ))}
            {folders.map((f) => (
              <CollectionTile
                key={f.id}
                to={`/library/${f.id}`}
                icon={f.icon}
                wash={f.wash}
                chip={f.chip}
                countClass={f.countClass}
                name={f.name}
                sub={
                  f.count !== undefined
                    ? `${f.count} ${f.count === 1 ? "item" : "items"}`
                    : "Collection"
                }
                count={f.count}
              />
            ))}
            <NewCollectionTile uid={uid} />
          </div>
        </section>

        {recent.length > 0 && (
          <section>
            <SectionTitle icon={Clock}>Recent saves</SectionTitle>
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              {recent.map((h) => (
                <RecentSaveRow
                  key={h.id}
                  hit={h}
                  onOpen={() => goToHit(navigate, h.app, h.ref_id)}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function LibraryHome() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LibraryIcon className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <LibraryHomeContent uid={user.uid} />
    </AppShell>
  );
}
