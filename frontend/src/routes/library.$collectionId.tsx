import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FolderPlus, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useCategoryMeta } from "@/contexts/category-meta";
import {
  watchCollections,
  getNotesByIds,
  updateCollectionMeta,
  deleteCollection,
  removeNoteFromCollection,
  getUserCategories,
} from "@/lib/firestore";
import { iconByName, paletteAccent } from "@/lib/note-meta";
import { FOCUS_RING } from "@/lib/ui";
import { NoteCard } from "@/components/NoteCard";
import { NoteMenuProvider } from "@/components/NoteContextMenu";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppShell } from "@/components/AppShell";
import type { Collection, Note } from "@/lib/types";

export const Route = createFileRoute("/library/$collectionId")({ component: CollectionDetail });

const GRID_CLS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function CollectionDetail() {
  const { collectionId } = Route.useParams();
  const { user, loading } = useAuth();
  useCategoryMeta();
  const navigate = useNavigate();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [resolved, setResolved] = useState(false); // the collections subscription has reported
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  // Live subscription so a removal/rename reflects immediately. Find this collection by id.
  useEffect(() => {
    if (!user) return;
    getUserCategories(user.uid).then(setCategories).catch(() => {});
    return watchCollections(
      user.uid,
      (cols) => {
        setCollection(cols.find((c) => c.id === collectionId) ?? null);
        setResolved(true);
      },
      { onError: () => setResolved(true) },
    );
  }, [user, collectionId]);

  // Re-fetch the member notes whenever the membership list changes (add/remove).
  const noteIdsKey = (collection?.note_ids ?? []).join(",");
  useEffect(() => {
    if (!collection) return;
    getNotesByIds(collection.note_ids ?? [])
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [noteIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (collection && !editingName) setName(collection.name);
  }, [collection, editingName]);

  const accent = useMemo(
    () => (collection?.palette != null ? paletteAccent(collection.palette) : null),
    [collection],
  );
  const Icon = iconByName(collection?.icon) ?? FolderPlus;

  const saveName = async () => {
    const next = name.trim();
    setEditingName(false);
    if (!collection || !next || next === collection.name) {
      setName(collection?.name ?? "");
      return;
    }
    await updateCollectionMeta(collection.id, { name: next }).catch(() => {});
  };

  const remove = async (noteId: string) => {
    if (!collection) return;
    await removeNoteFromCollection(collection.id, noteId).catch(() => {});
  };

  const del = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2500);
      return;
    }
    if (!collection) return;
    await deleteCollection(collection.id).catch(() => {});
    navigate({ to: "/library" });
  };

  if (loading || !user || !resolved) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Sparkles className="h-6 w-6 animate-pulse text-ink-soft" />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-ink-soft">
        <span>Collection not found.</span>
        <Link to="/library" className="rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-ink">
          Back to Library
        </Link>
      </div>
    );
  }

  return (
    <NoteMenuProvider categories={categories} collections={[collection]} uid={user.uid}>
      <AppShell>
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8">
            <Link
              to="/library"
              className="inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" />
              Library
            </Link>
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
        </header>

        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-8">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                accent ? accent.chip : "bg-ink/5 text-ink-soft"
              }`}
            >
              <Icon className="h-6 w-6" />
            </span>
            {editingName ? (
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
            )}
          </div>
          <p className="text-sm text-ink-soft">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </p>

          {notes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-ink-soft">
              No notes yet. Open a note and use “Add to collection”, or long-press a card in the
              feed.
            </p>
          ) : (
            <section className={GRID_CLS}>
              {notes.map((n) => (
                <div key={n.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    aria-label="Remove from collection"
                    title="Remove from collection"
                    className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-ink-soft opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
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
