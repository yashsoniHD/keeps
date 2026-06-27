import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  FolderPlus,
  Library as LibraryIcon,
  PenLine,
  Star,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import { watchCollections, watchFavorites, watchNotes, createCollection } from "@/lib/firestore";
import { listCategories, type CategoryInfo } from "@/lib/api";
import { iconByName, noteAccent, noteIcon, noteLabel, paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { AppShell } from "@/components/AppShell";
import type { Collection } from "@/lib/types";

export const Route = createFileRoute("/library/")({ component: LibraryScreen });

const ICON_BTN =
  "inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink";

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-xs uppercase tracking-wider text-ink-soft">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </h2>
  );
}

// A uniform folder tile — Favorites, Your notes, and every user collection now share this
// shape and open to their own page of notes. `chip` is the icon-badge colour class.
function FolderCard({
  collectionId,
  icon: Icon,
  chip,
  name,
  count,
}: {
  collectionId: string;
  icon: LucideIcon;
  chip: string;
  name: string;
  count: number;
}) {
  return (
    <Link
      to="/library/$collectionId"
      params={{ collectionId }}
      className={`group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg ${FOCUS_RING}`}
    >
      <span
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${chip}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{name}</span>
        <span className="block text-xs text-ink-soft">
          {count} {count === 1 ? "note" : "notes"}
        </span>
      </span>
    </Link>
  );
}

// A category — compact card (2-up on mobile) that opens the feed pre-filtered to it.
function CategoryCard({ cat }: { cat: CategoryInfo }) {
  const accent = cat.palette != null ? paletteAccent(cat.palette) : noteAccent(cat.slug);
  const Icon = iconByName(cat.icon) ?? noteIcon(cat.slug);
  return (
    <Link
      to="/"
      search={{ type: cat.slug }}
      className={`group flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md sm:p-3 ${FOCUS_RING}`}
    >
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 ${accent.chip}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium capitalize text-ink">
          {noteLabel(cat.slug)}
        </span>
        <span className="block text-[11px] text-ink-soft">
          {cat.count} {cat.count === 1 ? "note" : "notes"}
        </span>
      </span>
    </Link>
  );
}

// Inline "create a folder" tile — names and creates a collection in one step (no modal).
function NewCollectionTile({ uid }: { uid: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await createCollection(uid, n);
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
        className={`flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 p-4 text-ink-soft transition-colors hover:text-ink ${FOCUS_RING}`}
      >
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink/5">
          <FolderPlus className="h-5 w-5" />
        </span>
        <span className="font-medium">New collection</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3">
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
        placeholder="Collection name"
        className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-ink-soft"
      />
      <button
        type="button"
        onClick={create}
        aria-label="Create"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-paper active:scale-95"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          setName("");
          setOpen(false);
        }}
        aria-label="Cancel"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function LibraryScreen() {
  const { user, loading } = useAuth();
  useCategoryMeta(); // reflect category icon/colour overrides on the cards
  const navigate = useNavigate();
  const [favorites, setFavorites] = useState<number>(0);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [manualCount, setManualCount] = useState<number>(0);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    const unsubFav = watchFavorites(user.uid, (n) => setFavorites(n.length), { onError: () => {} });
    const unsubCol = watchCollections(user.uid, setCollections, { onError: () => {} });
    // A generous window to count the user's own (manual) notes without paging.
    const unsubNotes = watchNotes(
      user.uid,
      (all) => setManualCount(all.filter((n) => n.input_type && n.input_type !== "url").length),
      { max: 200 },
    );
    listCategories()
      .then(setCategories)
      .catch(() => {});
    return () => {
      unsubFav();
      unsubCol();
      unsubNotes();
    };
  }, [user]);

  // Favorites and "Your notes" are presented as folders alongside real collections — they open
  // to the same detail page (resolved as virtual ids there). Empty ones are hidden to avoid
  // dead-end folders.
  const folders = useMemo(() => {
    const virtuals: Array<{
      id: string;
      icon: LucideIcon;
      chip: string;
      name: string;
      count: number;
    }> = [];
    if (favorites > 0)
      virtuals.push({
        id: "favorites",
        icon: Star,
        chip: "bg-amber-400/15 text-amber-500",
        name: "Favorites",
        count: favorites,
      });
    if (manualCount > 0)
      virtuals.push({
        id: "manual",
        icon: PenLine,
        chip: "bg-ink/5 text-ink-soft",
        name: "Your notes",
        count: manualCount,
      });
    const real = collections.map((c) => ({
      id: c.id,
      icon: iconByName(c.icon) ?? FolderPlus,
      chip: c.palette != null ? paletteAccent(c.palette).chip : "bg-ink/5 text-ink-soft",
      name: c.name,
      count: (c.note_ids ?? []).length,
    }));
    return [...virtuals, ...real];
  }, [favorites, manualCount, collections]);

  const withNotes = categories.filter((c) => c.count > 0);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LibraryIcon className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  return (
    <AppShell>
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Notes
          </Link>
          <h1 className="font-serif text-xl text-ink">Library</h1>
          <span className={ICON_BTN} aria-hidden>
            <LibraryIcon className="h-4 w-4" />
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 md:px-8">
        <section>
          <SectionTitle icon={FolderPlus}>Collections</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {folders.map((f) => (
              <FolderCard
                key={f.id}
                collectionId={f.id}
                icon={f.icon}
                chip={f.chip}
                name={f.name}
                count={f.count}
              />
            ))}
            <NewCollectionTile uid={user.uid} />
          </div>
        </section>

        {withNotes.length > 0 && (
          <section>
            <SectionTitle icon={LibraryIcon}>Categories</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
              {withNotes.map((c) => (
                <CategoryCard key={c.slug} cat={c} />
              ))}
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
