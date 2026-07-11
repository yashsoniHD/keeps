import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FolderPlus, Plus } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  watchCollections,
  getMiniAppItemCounts,
  getCollectionNoteCount,
  type MiniAppItemCounts,
} from "@/lib/firestore";
import { TOOLS, type AppKey } from "@/lib/collections-meta";
import { iconByName, paletteAccent, defaultPaletteFor } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { AppShell } from "@/components/AppShell";
import { NewCollectionSheet } from "@/components/library/NewCollectionSheet";
import type { Collection } from "@/lib/types";

// The Collections page: the five mini-apps (Watchlist, Wishlist, Places, Recipes, Trips) as
// color-coded tiles with live item counts, plus the user's own smart collections below.
// Promoted from the old full-screen overlay in CategoryFilter so it's a real, linkable route
// that mini-app back buttons can return to.
export const Route = createFileRoute("/collections")({ component: CollectionsPage });

const TILE_GRID = "grid grid-cols-2 gap-3 lg:grid-cols-3";
const TILE_BASE = `flex min-h-[120px] flex-col justify-between gap-6 rounded-2xl border p-4 text-left transition-transform active:scale-[0.98] ${FOCUS_RING}`;

// Quiet count in a tile's top-right corner: skeleton while loading, "N saved" / "N notes" after.
function CountCorner({ count, unit }: { count: number | null; unit: string }) {
  if (count === null)
    return <span className="mt-1 h-4 w-12 shrink-0 animate-pulse rounded bg-ink/10" aria-hidden />;
  return (
    <span className="mt-1 shrink-0 whitespace-nowrap text-xs text-ink-soft">
      {count} {unit}
    </span>
  );
}

function CollectionsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [appCounts, setAppCounts] = useState<MiniAppItemCounts | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  // Per-collection note counts, filled in best-effort; a missing key renders no count.
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // One aggregate shot per subcollection on mount — quiet counts, no listeners.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getMiniAppItemCounts(user.uid)
      .then((c) => {
        if (!cancelled) setAppCounts(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  // The user's own smart collections, live (so a create/rename/delete reflects on return).
  useEffect(() => {
    if (!user) return;
    return watchCollections(user.uid, setCollections, { onError: () => {} });
  }, [user]);

  // Note counts per collection: cheap aggregate queries, best-effort (Collection docs carry
  // no count field; membership lives on each note's collection_id).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    collections.forEach((c) => {
      if (noteCounts[c.id] !== undefined) return;
      getCollectionNoteCount(user.uid, c.id)
        .then((n) => {
          if (!cancelled) setNoteCounts((prev) => ({ ...prev, [c.id]: n }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // noteCounts intentionally omitted: it only grows, and including it would refire per fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, collections]);

  if (loading || !user) return null;

  const apps = TOOLS.filter((t) => t.app); // drop the Notes catch-all — Notes is the home feed

  return (
    <AppShell>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 md:px-8">
          <Link
            to="/"
            aria-label="Back to Home"
            title="Home"
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="min-w-0 truncate font-serif text-2xl text-ink">Collections</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-5 md:px-8 md:py-6">
        <div className={TILE_GRID}>
          {apps.map((t) => {
            const Icon = t.icon;
            return (
              <Link key={t.key} to={t.to} className={`${TILE_BASE} ${t.wash}`}>
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${t.fill}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <CountCorner count={appCounts ? appCounts[t.app as AppKey] : null} unit="saved" />
                </div>
                <div className="min-w-0">
                  <div className={`truncate font-semibold ${t.text}`}>{t.label}</div>
                  <div className="truncate text-sm text-ink-soft">{t.desc}</div>
                </div>
              </Link>
            );
          })}
        </div>

        <section className="mt-8">
          <h2 className="px-1 text-xs uppercase tracking-wider text-ink-soft">Your collections</h2>
          <div className={`mt-3 ${TILE_GRID}`}>
            {collections.map((c) => {
              const accent = paletteAccent(c.palette ?? defaultPaletteFor(c.name));
              const Icon = iconByName(c.icon) ?? FolderPlus;
              const count = noteCounts[c.id];
              return (
                <Link
                  key={c.id}
                  to="/library/$collectionId"
                  params={{ collectionId: c.id }}
                  className={`${TILE_BASE} ${accent.wash}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${accent.dot} text-white`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    {count !== undefined && (
                      <CountCorner count={count} unit={count === 1 ? "note" : "notes"} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className={`truncate font-semibold ${accent.text}`}>{c.name}</div>
                  </div>
                </Link>
              );
            })}

            {/* New collection: opens the same smart-collection sheet the Library uses. */}
            <button
              type="button"
              onClick={() => setShowNew(true)}
              className={`${TILE_BASE} border-dashed border-border bg-card/50 text-ink-soft transition-colors hover:text-ink`}
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border bg-card">
                <Plus className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">New collection</div>
                <div className="truncate text-sm text-ink-soft">Trips, gifts, anything</div>
              </div>
            </button>
          </div>
        </section>
      </main>

      {showNew && <NewCollectionSheet uid={user.uid} onClose={() => setShowNew(false)} />}
    </AppShell>
  );
}
