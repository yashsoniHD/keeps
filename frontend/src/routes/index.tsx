import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  Clock,
  FolderPlus,
  Library as LibraryIcon,
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
  watchRecent,
  createCollection,
  getToolCounts,
  type ToolCounts,
} from "@/lib/firestore";
import { backfillCollection } from "@/lib/api";
import { goToHit } from "@/lib/nav";
import { iconByName, noteIcon, paletteAccent } from "@/lib/note-meta";
import { TOOLS } from "@/lib/collections-meta";
import { FOCUS_RING } from "@/lib/ui";
import { AppShell, useCapture } from "@/components/AppShell";
import type { Collection, SearchHit } from "@/lib/types";

// The Library is the home: a launchpad wall of collections. Everything the user saves is a
// collection — the app-backed tools (Watchlist, Recipes, …), the Notes catch-all, virtual
// folders (Favorites, Your notes), and their own smart collections — all one bold surface.
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

// The signature Signal tile: a bold, full-color collection card with a big ghost numeral and a
// springy press. Every collection — tool, folder, or smart bucket — wears this shape.
function CollectionTile({
  to,
  onClick,
  icon: Icon,
  fill,
  name,
  sub,
  count,
}: {
  to?: string;
  onClick?: () => void;
  icon: LucideIcon;
  fill: string; // e.g. "bg-media text-white"
  name: string;
  sub: string;
  count?: number;
}) {
  const body = (
    <>
      <Icon className="h-6 w-6 opacity-95" />
      {count !== undefined && (
        <span className="pointer-events-none absolute -right-2 top-1 select-none font-display text-6xl font-semibold tabular-nums opacity-15">
          {count}
        </span>
      )}
      <span className="relative">
        <span className="block truncate font-display text-lg leading-tight">{name}</span>
        <span className="mt-0.5 block truncate text-sm opacity-80">{sub}</span>
      </span>
    </>
  );
  const cls = `press ${FOCUS_RING} relative flex h-32 flex-col justify-between overflow-hidden rounded-3xl p-4 shadow-sm transition-shadow hover:shadow-lg ${fill}`;
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={`${cls} text-left`}>
      {body}
    </button>
  );
}

// A "recent save" card in the horizontal strip — routes to its destination (note or /<app>/$id).
function RecentCard({ hit, onOpen }: { hit: SearchHit; onOpen: () => void }) {
  const Icon = noteIcon(hit.kind || "note");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`press flex w-40 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-left transition-shadow hover:shadow-md ${FOCUS_RING}`}
    >
      <div className="relative h-24 w-full bg-muted">
        {hit.cover_image_url ? (
          <img src={hit.cover_image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Icon className="h-6 w-6 text-ink-soft" />
          </div>
        )}
      </div>
      <span className="line-clamp-2 px-3 py-2 text-sm font-medium text-ink">{hit.title || "Untitled"}</span>
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
        className={`press flex h-32 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-border bg-card/40 text-ink-soft transition-colors hover:border-brand hover:text-brand ${FOCUS_RING}`}
      >
        <FolderPlus className="h-6 w-6" />
        <span className="text-sm font-medium">New collection</span>
      </button>
    );
  }

  return (
    <div className="flex h-32 flex-col justify-center gap-2 rounded-3xl border border-border bg-card p-4">
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
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand text-brand-foreground active:scale-95"
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
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [counts, setCounts] = useState<ToolCounts>({});

  useEffect(() => {
    const unsubFav = watchFavorites(uid, (n) => setFavorites(n.length), { onError: () => {} });
    const unsubCol = watchCollections(uid, setCollections, { onError: () => {} });
    const unsubRecent = watchRecent(uid, setRecent, { max: 8, onError: () => {} });
    const unsubNotes = watchNotes(
      uid,
      (all) => setManualCount(all.filter((n) => n.input_type && n.input_type !== "url").length),
      { max: 200 },
    );
    getToolCounts(uid).then(setCounts).catch(() => {});
    return () => {
      unsubFav();
      unsubCol();
      unsubRecent();
      unsubNotes();
    };
  }, [uid]);

  // Virtual folders (Favorites / Your notes) sit alongside real collections. Empty ones hide.
  const folders = useMemo(() => {
    const out: Array<{ id: string; icon: LucideIcon; fill: string; name: string; count?: number }> = [];
    if (favorites > 0)
      out.push({ id: "favorites", icon: Star, fill: "bg-summary text-white", name: "Favorites", count: favorites });
    if (manualCount > 0)
      out.push({ id: "manual", icon: PenLine, fill: "bg-secondary text-ink", name: "Your notes", count: manualCount });
    for (const c of collections) {
      const accent = c.palette != null ? paletteAccent(c.palette) : null;
      out.push({
        id: c.id,
        icon: iconByName(c.icon) ?? FolderPlus,
        fill: `${accent ? accent.dot : "bg-brand"} text-white`,
        name: c.name,
      });
    }
    return out;
  }, [favorites, manualCount, collections]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-brand-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-display text-2xl text-ink">Clipnote</span>
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

      <main className="mx-auto max-w-7xl space-y-9 px-4 py-8 md:px-8">
        {/* Hero: one friendly capture action. */}
        <button
          type="button"
          onClick={() => openCapture()}
          className={`press flex w-full items-center gap-3 rounded-full bg-brand px-5 py-4 text-left text-brand-foreground shadow-lg shadow-brand/25 ${FOCUS_RING}`}
        >
          <Plus className="h-5 w-5 shrink-0" />
          <span className="font-medium">Save a link, note, photo, or voice memo…</span>
        </button>

        {recent.length > 0 && (
          <section>
            <SectionTitle icon={Clock}>Recent saves</SectionTitle>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recent.map((h) => (
                <RecentCard key={h.id} hit={h} onOpen={() => goToHit(navigate, h.app, h.ref_id)} />
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionTitle icon={LibraryIcon}>Collections</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {TOOLS.map((t) => (
              <CollectionTile
                key={t.key}
                to={t.to}
                icon={t.icon}
                fill={t.fill}
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
                fill={f.fill}
                name={f.name}
                sub={f.count !== undefined ? `${f.count} ${f.count === 1 ? "item" : "items"}` : "Collection"}
                count={f.count}
              />
            ))}
            <NewCollectionTile uid={uid} />
          </div>
        </section>
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
