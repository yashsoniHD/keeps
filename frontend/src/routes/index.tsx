import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  Clock,
  FolderPlus,
  Library as LibraryIcon,
  Link2,
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
  watchNotes,
  watchRecentSaves,
  createCollection,
  getToolCounts,
  type ToolCounts,
} from "@/lib/firestore";
import { backfillCollection } from "@/lib/api";
import { goToDestination } from "@/lib/nav";
import { iconByName, paletteAccent } from "@/lib/note-meta";
import { TOOLS, toolByApp } from "@/lib/collections-meta";
import { FOCUS_RING } from "@/lib/ui";
import { AppShell, useCapture } from "@/components/AppShell";
import type { Collection, Job } from "@/lib/types";

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

// A collection card: white card, tinted icon square, serif name, quiet count.
// Every collection — tool, folder, or smart bucket — wears this shape.
function CollectionTile({
  to,
  icon: Icon,
  tint,
  name,
  sub,
  count,
}: {
  to: string;
  icon: LucideIcon;
  tint: string; // soft chip classes, e.g. "bg-media-soft text-media"
  name: string;
  sub: string;
  count?: number;
}) {
  return (
    <Link
      to={to}
      className={`press ${FOCUS_RING} flex h-28 flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:h-32`}
    >
      <div className="flex items-start justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tint}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        {count !== undefined && count > 0 && (
          <span className="text-sm tabular-nums text-ink-soft">{count}</span>
        )}
      </div>
      <span className="min-w-0">
        <span className="block truncate font-serif text-lg leading-tight text-ink">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-soft">{sub}</span>
      </span>
    </Link>
  );
}

// One recent save — a CAPTURE (job), not a fanned-out item: a reel that produced five watchlist
// titles is one row here. Routes to wherever the capture landed (note, item, or app index).
function RecentSaveRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const domain = useMemo(() => {
    try {
      return job.url ? new URL(job.url).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  }, [job.url]);

  const tool = job.destination?.kind === "app" ? toolByApp(job.destination.app) : null;
  const title = job.title || domain || "Saved item";
  const subParts = [
    domain,
    job.item_count && job.item_count > 1 ? `${job.item_count} items` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 ${FOCUS_RING}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        {domain ? (
          <img
            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
            alt=""
            loading="lazy"
            className="h-4.5 w-4.5 rounded-sm"
          />
        ) : job.title ? (
          <PenLine className="h-4 w-4 text-ink-soft" />
        ) : (
          <Link2 className="h-4 w-4 text-ink-soft" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        {subParts.length > 0 && (
          <span className="block truncate text-xs text-ink-soft">{subParts.join(" · ")}</span>
        )}
      </span>
      {tool && (
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tool.soft}`}
        >
          {tool.label}
        </span>
      )}
    </button>
  );
}

// Inline "create a collection" tile — names + describes a bucket, then sweeps in matching existing
// notes via the backend backfill. The description also steers the AI classifier for future saves.
function NewCollectionTile({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const id = await createCollection(uid, n, { description: n });
      backfillCollection(id).catch(() => {});
      setName("");
      setOpen(false);
    } catch {
      /* leave the input; the user can retry */
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`press flex h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card/40 text-ink-soft transition-colors hover:border-ink/30 hover:text-ink sm:h-32 ${FOCUS_RING}`}
      >
        <FolderPlus className="h-5 w-5" />
        <span className="text-sm font-medium">New collection</span>
      </button>
    );
  }

  return (
    <div className="flex h-28 flex-col justify-center gap-2 rounded-2xl border border-border bg-card p-4 sm:h-32">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") create();
          if (e.key === "Escape") {
            setName("");
            setOpen(false);
          }
        }}
        placeholder="e.g. Software"
        className="w-full rounded-full border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-ink-soft"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={() => {
            setName("");
            setOpen(false);
          }}
          aria-label="Cancel"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={create}
          aria-label="Create collection"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-paper active:scale-95"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// The home content — a child of AppShell so it can trigger the shell-owned capture flow.
function LibraryHomeContent({ uid }: { uid: string }) {
  useCategoryMeta(); // reflect category icon/colour overrides on collection tiles
  const navigate = useNavigate();
  const { openCapture } = useCapture();
  const [favorites, setFavorites] = useState(0);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [manualCount, setManualCount] = useState(0);
  const [recent, setRecent] = useState<Job[]>([]);
  const [counts, setCounts] = useState<ToolCounts>({});

  useEffect(() => {
    const unsubFav = watchFavorites(uid, (n) => setFavorites(n.length), { onError: () => {} });
    const unsubCol = watchCollections(uid, setCollections, { onError: () => {} });
    const unsubRecent = watchRecentSaves(uid, setRecent, { max: 8, onError: () => {} });
    const unsubNotes = watchNotes(
      uid,
      (all) => setManualCount(all.filter((n) => n.input_type && n.input_type !== "url").length),
      { max: 200 },
    );
    getToolCounts(uid)
      .then(setCounts)
      .catch(() => {});
    return () => {
      unsubFav();
      unsubCol();
      unsubRecent();
      unsubNotes();
    };
  }, [uid]);

  // Virtual folders (Favorites / Your notes) sit alongside real collections. Empty ones hide.
  const folders = useMemo(() => {
    const out: Array<{ id: string; icon: LucideIcon; tint: string; name: string; count?: number }> =
      [];
    if (favorites > 0)
      out.push({
        id: "favorites",
        icon: Star,
        tint: "bg-summary-soft text-summary",
        name: "Favorites",
        count: favorites,
      });
    if (manualCount > 0)
      out.push({
        id: "manual",
        icon: PenLine,
        tint: "bg-secondary text-ink-soft",
        name: "Your notes",
        count: manualCount,
      });
    for (const c of collections) {
      const accent = c.palette != null ? paletteAccent(c.palette) : null;
      out.push({
        id: c.id,
        icon: iconByName(c.icon) ?? FolderPlus,
        tint: accent ? accent.chip : "bg-secondary text-ink-soft",
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
            <Link to="/settings" aria-label="Settings" title="Settings" className={ICON_BTN}>
              <Settings className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-9 px-4 py-6 md:px-8 md:py-8">
        {/* Capture: one friendly, always-visible entry point styled like a search field. */}
        <button
          type="button"
          onClick={() => openCapture()}
          className={`press flex w-full items-center gap-3 rounded-full border border-border bg-card px-5 py-3.5 text-left text-ink-soft shadow-sm transition-shadow hover:shadow-md ${FOCUS_RING}`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
            <Plus className="h-4 w-4" />
          </span>
          <span className="text-sm">Save a link, note, photo, or voice memo…</span>
        </button>

        <section>
          <SectionTitle icon={LibraryIcon}>Collections</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {TOOLS.map((t) => (
              <CollectionTile
                key={t.key}
                to={t.to}
                icon={t.icon}
                tint={t.soft}
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
                tint={f.tint}
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
              {recent.map((j) => (
                <RecentSaveRow
                  key={j.id}
                  job={j}
                  onOpen={() => goToDestination(navigate, j.destination, j.note_id)}
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
