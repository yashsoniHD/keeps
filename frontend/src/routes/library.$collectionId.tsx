import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  FolderPlus,
  PenLine,
  Pencil,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import {
  watchCollections,
  watchFavorites,
  watchNotes,
  watchNotesInCollection,
  updateCollectionMeta,
  deleteCollection,
  getUserCategories,
} from "@/lib/firestore";
import {
  updateNote,
  excludeNoteFromCollection,
  rescoreCollection,
  deleteCollectionApi,
} from "@/lib/api";
import { iconByName, paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING, HIT_44_SM } from "@/lib/ui";
import { NoteCard } from "@/components/NoteCard";
import { NoteMenuProvider } from "@/components/NoteContextMenu";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppShell } from "@/components/AppShell";
import type { Collection, Note } from "@/lib/types";

export const Route = createFileRoute("/library/$collectionId")({ component: CollectionDetail });

const GRID_CLS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function Loader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
    </div>
  );
}

// Shared chrome for any folder page: header (with optional right-side action), title row, and
// the member-notes grid. Each note card may render a per-card `action` (the hover X).
function FolderShell({
  uid,
  categories,
  icon: Icon,
  chip,
  notes,
  title,
  headerAction,
  noteAction,
  empty,
}: {
  uid: string;
  categories: string[];
  icon: LucideIcon;
  chip: string;
  notes: Note[];
  title: ReactNode;
  headerAction?: ReactNode;
  noteAction?: (note: Note) => ReactNode;
  empty: ReactNode;
}) {
  return (
    <NoteMenuProvider categories={categories} collections={[]} uid={uid}>
      <AppShell>
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" />
              Library
            </Link>
            {headerAction}
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-8">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${chip}`}
            >
              <Icon className="h-6 w-6" />
            </span>
            {title}
          </div>
          <p className="text-sm text-ink-soft">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </p>

          {notes.length === 0 ? (
            empty
          ) : (
            <section className={GRID_CLS}>
              {notes.map((n) => (
                <div key={n.id} className="group relative">
                  {noteAction?.(n)}
                  <ErrorBoundary label="collection-card" fallback={null}>
                    <NoteCard note={n} />
                  </ErrorBoundary>
                </div>
              ))}
            </section>
          )}
        </main>
      </AppShell>
    </NoteMenuProvider>
  );
}

const RemoveButton = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-ink-soft opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100 ${HIT_44_SM}`}
  >
    <X className="h-3.5 w-3.5" />
  </button>
);

// Favorites / Your notes — folders backed by a live query, not a stored note_ids list. No
// rename or delete; the per-card action unstars (favorites) or is absent (manual notes).
function VirtualFolder({ uid, kind }: { uid: string; kind: "favorites" | "manual" }) {
  useCategoryMeta();
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    getUserCategories(uid)
      .then(setCategories)
      .catch(() => {});
    if (kind === "favorites") return watchFavorites(uid, setNotes, { onError: () => {} });
    return watchNotes(
      uid,
      (all) => setNotes(all.filter((n) => n.input_type && n.input_type !== "url")),
      { max: 200 },
    );
  }, [uid, kind]);

  const meta =
    kind === "favorites"
      ? { name: "Favorites", Icon: Star, chip: "bg-favorite-soft text-favorite-chip" }
      : { name: "Your notes", Icon: PenLine, chip: "bg-ink/5 text-ink-soft" };

  const unfavorite = (noteId: string) => {
    updateNote(noteId, { is_favorite: false }).catch(() => {});
  };

  return (
    <FolderShell
      uid={uid}
      categories={categories}
      icon={meta.Icon}
      chip={meta.chip}
      notes={notes}
      title={<h1 className="min-w-0 truncate font-serif text-3xl text-ink">{meta.name}</h1>}
      noteAction={
        kind === "favorites"
          ? (n) => <RemoveButton onClick={() => unfavorite(n.id)} label="Remove from favorites" />
          : undefined
      }
      empty={
        <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-ink-soft">
          {kind === "favorites"
            ? "No favorites yet. Long-press a card and tap the star, or open a note and favorite it."
            : "No notes you’ve written yet. Use the + button to write, record, or upload a note."}
        </p>
      }
    />
  );
}

// A real, user-created collection — membership is a live query on collection_ids; supports
// rename + delete + a manual rescan.
function RealCollection({ uid, collectionId }: { uid: string; collectionId: string }) {
  useCategoryMeta();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [resolved, setResolved] = useState(false); // the collections subscription has reported
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState<string | null>(null);

  // Live subscription so a removal/rename reflects immediately. Find this collection by id.
  useEffect(() => {
    getUserCategories(uid)
      .then(setCategories)
      .catch(() => {});
    return watchCollections(
      uid,
      (cols) => {
        setCollection(cols.find((c) => c.id === collectionId) ?? null);
        setResolved(true);
      },
      { onError: () => setResolved(true) },
    );
  }, [uid, collectionId]);

  // Membership is a live query on each note's collection_ids array (multi-home, backend-written
  // by the embedding matcher/rescore/pin/exclude), not a stored note_ids list — so a newly-filed
  // note appears here live.
  useEffect(() => {
    return watchNotesInCollection(uid, collectionId, setNotes, { onError: () => setNotes([]) });
  }, [uid, collectionId]);

  useEffect(() => {
    if (collection && !editingName) setName(collection.name);
  }, [collection, editingName]);

  const accent = useMemo(
    () => (collection?.palette != null ? paletteAccent(collection.palette) : null),
    [collection],
  );
  const Icon = iconByName(collection?.icon) ?? FolderPlus;

  const rescan = async (silent = false) => {
    if (rescanning) return;
    setRescanning(true);
    if (!silent) setRescanMsg(null);
    try {
      const res = await rescoreCollection(collectionId);
      setRescanMsg(
        res.added || res.removed
          ? `${res.added} added, ${res.removed} removed`
          : "Everything's up to date",
      );
    } catch {
      setRescanMsg("Couldn't rescan. Try again.");
    } finally {
      setRescanning(false);
      setTimeout(() => setRescanMsg(null), 4000);
    }
  };

  const saveName = async () => {
    const next = name.trim();
    setEditingName(false);
    if (!collection || !next || next === collection.name) {
      setName(collection?.name ?? "");
      return;
    }
    await updateCollectionMeta(collection.id, { name: next }).catch(() => {});
    // Renaming changes the topic — resync the embedding + membership. Best-effort: a failure
    // just leaves the old embedding until the next manual rescan.
    rescan(true).catch(() => {});
  };

  // Removing a note from a collection excludes it — a hard override that survives a later
  // rescore (it won't silently reappear on the next resync). Written through the backend
  // (notes are backend-write-only); the live query drops it here.
  const remove = async (noteId: string) => {
    await excludeNoteFromCollection(collectionId, noteId).catch(() => {});
  };

  const del = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2500);
      return;
    }
    if (!collection) return;
    try {
      await deleteCollectionApi(collection.id);
    } catch {
      await deleteCollection(collection.id).catch(() => {}); // fallback: at least remove the folder
    }
    navigate({ to: "/" });
  };

  if (!resolved) return <Loader />;

  if (!collection) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-ink-soft">
        <span>Collection not found.</span>
        <Link
          to="/"
          className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-ink"
        >
          Back to Library
        </Link>
      </div>
    );
  }

  return (
    <FolderShell
      uid={uid}
      categories={categories}
      icon={Icon}
      chip={accent ? accent.chip : "bg-ink/5 text-ink-soft"}
      notes={notes}
      title={
        editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") {
                setName(collection.name);
                setEditingName(false);
              }
            }}
            onBlur={saveName}
            aria-label="Collection name"
            className="min-w-0 flex-1 border-b border-border bg-transparent font-serif text-3xl text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            title="Rename collection"
            className={`group flex min-w-0 items-center gap-2 text-left font-serif text-3xl text-ink ${FOCUS_RING}`}
          >
            <span className="truncate">{collection.name}</span>
            <Pencil className="h-4 w-4 shrink-0 text-ink-soft opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )
      }
      headerAction={
        <div className="flex items-center gap-2">
          {rescanMsg && (
            <span
              role="status"
              className="hidden max-w-[10rem] truncate text-xs text-ink-soft sm:inline"
            >
              {rescanMsg}
            </span>
          )}
          <button
            type="button"
            onClick={() => rescan()}
            disabled={rescanning}
            aria-label="Rescan collection"
            title="Rescan collection"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-ink-soft transition-colors hover:text-ink disabled:opacity-60 ${FOCUS_RING}`}
          >
            <RefreshCw className={`h-4 w-4 ${rescanning ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={del}
            aria-label="Delete collection"
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full border text-sm transition-colors ${
              confirmDelete
                ? "border-destructive bg-destructive px-3 text-white"
                : "w-9 border-border bg-card text-ink-soft hover:text-destructive"
            }`}
          >
            <Trash2 className="h-4 w-4" />
            {confirmDelete && "Sure?"}
          </button>
        </div>
      }
      noteAction={(n) => (
        <RemoveButton onClick={() => remove(n.id)} label="Remove from collection" />
      )}
      empty={
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-10 text-center">
          <span
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${
              accent ? `${accent.dot} ${accent.on}` : "bg-secondary text-ink-soft"
            }`}
          >
            <Icon className="h-5 w-5" />
          </span>
          <p className="mt-3 font-serif text-lg text-ink">Nothing filed here yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
            New saves that match this collection land here automatically, or move a note in from
            its ⋯ menu.
          </p>
        </div>
      }
    />
  );
}

function CollectionDetail() {
  const { collectionId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  if (loading || !user) return <Loader />;
  if (collectionId === "favorites" || collectionId === "manual")
    return <VirtualFolder uid={user.uid} kind={collectionId} />;
  return <RealCollection uid={user.uid} collectionId={collectionId} />;
}
