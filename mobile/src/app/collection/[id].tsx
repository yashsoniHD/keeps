import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  FolderPlus,
  MoreVertical,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import type { Collection, Note } from "@clipnote/shared";
import { watchCollections, watchNotesInCollection } from "@/lib/firestore";
import {
  ApiError,
  buildCollectionDigest,
  deleteCollectionApi,
  deleteNote,
  excludeNoteFromCollection,
  pinNoteToCollection,
  rescoreCollection,
} from "@/lib/api";
import { deleteCollection } from "@/lib/firestore";
import { iconByName, interopIcon, paletteAccent } from "@/lib/note-meta";
import { useAuth } from "@/contexts/auth-context";
import { useTheme } from "@/theme/ThemeProvider";
import { dark, light } from "@/theme/tokens";
import { NoteCard } from "@/components/feed/NoteCard";
import { CollectionDigestView } from "@/components/library/CollectionDigestView";
import { EditCollectionSheet } from "@/components/library/EditCollectionSheet";

[ChevronLeft, FolderPlus, MoreVertical, Pencil, RefreshCw, Sparkles, Trash2].forEach(interopIcon);

// Debounce before a lazy digest (re)build fires — gives a burst of membership changes (e.g. a
// rescan that adds several notes) time to settle before spending an AI call. Mirrors the web's
// DIGEST_BUILD_DEBOUNCE_MS.
const DIGEST_BUILD_DEBOUNCE_MS = 1500;

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const collectionId = String(id);
  const { user } = useAuth();
  const router = useRouter();
  const { resolved } = useTheme();
  const t = resolved === "dark" ? dark : light;

  const [collection, setCollection] = useState<Collection | null>(null);
  const [resolvedCollections, setResolvedCollections] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesResolved, setNotesResolved] = useState(false);
  const [notesError, setNotesError] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // --- Living-view digest ---------------------------------------------------------------
  // `digestBusy` covers both the lazy auto-build and the manual "Refresh digest" force-build.
  // `attemptedSignatureRef` remembers the member-id signature the last build was attempted
  // against, so a capped/failed response doesn't get retried in a loop on every render.
  const [digestBusy, setDigestBusy] = useState(false);
  const attemptedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return watchCollections(
      user.uid,
      (cols) => {
        setCollection(cols.find((c) => c.id === collectionId) ?? null);
        setResolvedCollections(true);
      },
      { onError: () => setResolvedCollections(true) },
    );
  }, [user, collectionId]);

  useEffect(() => {
    if (!user) return;
    setNotesError(false);
    setNotesResolved(false);
    return watchNotesInCollection(
      user.uid,
      collectionId,
      (ns) => {
        setNotesError(false);
        setNotes(ns);
        setNotesResolved(true);
      },
      {
        onError: () => {
          setNotesError(true);
          setNotes([]);
          setNotesResolved(true);
        },
      },
    );
  }, [user, collectionId]);

  // Membership signature (sorted note ids) — compares against the digest's own
  // `source_note_ids` to detect staleness, and gates the lazy-build effect below.
  const currentIds = useMemo(() => notes.map((n) => n.id).sort(), [notes]);
  const signature = currentIds.join(",");
  const digest = collection?.digest ?? null;
  const digestStale = !!digest && signature !== [...digest.source_note_ids].sort().join(",");

  // Lazily (re)build the digest when the member set is new or has drifted since the last
  // build. The fresh digest arrives via `watchCollections`, not this response — this effect
  // only clears the busy flag.
  useEffect(() => {
    if (!notesResolved || notes.length === 0) return; // never call the endpoint with 0 notes
    if (digestBusy) return;
    if (!digest || digestStale) {
      if (attemptedSignatureRef.current === signature) return; // already tried this exact set
      const timer = setTimeout(() => {
        attemptedSignatureRef.current = signature;
        setDigestBusy(true);
        buildCollectionDigest(collectionId)
          .catch(() => {})
          .finally(() => setDigestBusy(false));
      }, DIGEST_BUILD_DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }
  }, [notesResolved, notes.length, digest, digestStale, digestBusy, signature, collectionId]);

  const refreshDigest = () => {
    if (digestBusy) return;
    attemptedSignatureRef.current = signature;
    setDigestBusy(true);
    buildCollectionDigest(collectionId, true)
      .catch(() => {})
      .finally(() => setDigestBusy(false));
  };

  const rescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    setRescanMsg(null);
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

  const del = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2500);
      return;
    }
    if (!collection || deleting) return;
    setDeleting(true);
    (async () => {
      try {
        await deleteCollectionApi(collection.id);
      } catch {
        await deleteCollection(collection.id).catch(() => {}); // fallback: at least remove the folder
      }
      router.back();
    })();
  };

  // Per-note collection actions: pin (a hard override that survives a later rescore) or exclude
  // (a hard override that removes it and keeps it out). NoteCard's own onLongPress is hardcoded
  // to a delete confirm, so this is a small always-visible overlay button on the card instead of
  // a long-press (the web equivalent is a hover-revealed "X"; touch has no hover, and NoteCard's
  // long-press slot is already taken). Exclude is optimistic — the note drops out of the grid
  // immediately and rolls back on failure; pin has no visible membership change (the note was
  // already showing), so it just confirms via the same alert.
  const onNoteActions = (note: Note) => {
    Alert.alert(note.title, undefined, [
      {
        text: "Pin to collection",
        onPress: () => {
          pinNoteToCollection(collectionId, note.id).catch((err) => {
            Alert.alert(
              "Couldn't pin",
              err instanceof ApiError ? err.message : "Please try again.",
            );
          });
        },
      },
      {
        text: "Exclude from collection",
        style: "destructive",
        onPress: () => {
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
          excludeNoteFromCollection(collectionId, note.id).catch((err) => {
            setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note])); // roll back
            Alert.alert(
              "Couldn't exclude",
              err instanceof ApiError ? err.message : "Please try again.",
            );
          });
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const onDeleteNote = (note: Note) => {
    // NoteCard's own delete confirm already fired. Optimistic removal, rolled back on failure.
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    deleteNote(note.id).catch(() => {
      setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
    });
  };

  if (!resolvedCollections) {
    return (
      <View className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color={t.ink} />
      </View>
    );
  }

  if (!collection) {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1 items-center justify-center gap-4 px-8" edges={["top"]}>
          <Text className="font-serif text-2xl text-ink">Collection not found</Text>
          <Pressable onPress={() => router.back()}>
            <Text className="text-summary">Go back</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const accent = paletteAccent(collection.palette ?? 0);
  const Icon = iconByName(collection.icon) ?? FolderPlus;

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1" edges={["top"]}>
        <View className="flex-row items-center justify-between px-4 py-2">
          <Pressable
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/library"))}
            className="h-10 w-10 items-center justify-center active:opacity-60"
          >
            <ChevronLeft size={24} color={t.ink} />
          </Pressable>
          <View className="flex-row items-center gap-1">
            {rescanMsg && (
              <Text className="mr-1 max-w-[110px] text-xs text-ink-soft" numberOfLines={1}>
                {rescanMsg}
              </Text>
            )}
            <Pressable
              accessibilityLabel="Rescan collection"
              onPress={rescan}
              disabled={rescanning}
              className="h-10 w-10 items-center justify-center active:opacity-60"
            >
              <RefreshCw size={20} color={t["ink-soft"]} style={rescanning ? { opacity: 0.5 } : undefined} />
            </Pressable>
            <Pressable
              accessibilityLabel="Refresh digest"
              onPress={refreshDigest}
              disabled={digestBusy || notes.length === 0}
              className="h-10 w-10 items-center justify-center active:opacity-60"
            >
              <Sparkles
                size={20}
                color={t["ink-soft"]}
                style={digestBusy || notes.length === 0 ? { opacity: 0.5 } : undefined}
              />
            </Pressable>
            <Pressable
              accessibilityLabel="Edit collection"
              onPress={() => setShowEdit(true)}
              className="h-10 w-10 items-center justify-center active:opacity-60"
            >
              <Pencil size={18} color={t["ink-soft"]} />
            </Pressable>
            <Pressable
              accessibilityLabel="Delete collection"
              onPress={del}
              disabled={deleting}
              className={`h-9 items-center justify-center rounded-full px-3 ${
                confirmDelete ? "bg-destructive" : ""
              }`}
            >
              {confirmDelete ? (
                <Text className="text-sm font-medium text-white">Sure?</Text>
              ) : (
                <Trash2 size={18} color={t["ink-soft"]} />
              )}
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerClassName="gap-6 px-5 pb-16 pt-2">
          <View className="flex-row items-center gap-3">
            <View className={`h-12 w-12 items-center justify-center rounded-2xl ${accent.dot} ${accent.on}`}>
              <Icon size={22} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="font-serif text-3xl leading-tight text-ink" numberOfLines={1}>
                {collection.name}
              </Text>
              {collection.description ? (
                <Text className="mt-0.5 text-sm text-ink-soft" numberOfLines={2}>
                  {collection.description}
                </Text>
              ) : null}
            </View>
          </View>
          <Text className="-mt-4 text-sm text-ink-soft">
            {notes.length} {notes.length === 1 ? "note" : "notes"}
          </Text>

          {notesError ? (
            <View className="items-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 px-4 py-10">
              <Text className="font-serif text-lg text-ink">Couldn't load this collection</Text>
              <Text className="text-center text-sm text-ink-soft">
                Something went wrong reaching your notes.
              </Text>
            </View>
          ) : (
            <>
              {digest ? (
                <CollectionDigestView
                  digest={digest}
                  notes={notes}
                  updating={digestBusy}
                  accent={accent}
                />
              ) : digestBusy ? (
                <View className="items-center gap-3 py-8">
                  <ActivityIndicator color={t["ink-soft"]} />
                  <Text className="text-sm text-ink-soft">Building the collection's view…</Text>
                </View>
              ) : null}

              {notesResolved && notes.length === 0 ? (
                <View className="items-center gap-2 rounded-2xl border border-dashed border-border bg-card/50 px-4 py-10">
                  <View className={`h-12 w-12 items-center justify-center rounded-2xl ${accent.dot} ${accent.on}`}>
                    <Icon size={20} />
                  </View>
                  <Text className="mt-2 font-serif text-lg text-ink">Nothing filed here yet</Text>
                  <Text className="text-center text-sm text-ink-soft">
                    New saves that match this collection land here automatically, or move a note
                    in from its card menu.
                  </Text>
                </View>
              ) : (
                // A plain flex-wrap grid, not FlashList: the member set is bounded (the same
                // watchNotesInCollection cap as the web's page-size query) and this page is
                // already one big ScrollView — nesting a virtualized list inside it would need
                // its own bounded height and just re-adds the scroll surface this page already
                // has. Two columns, matching the Library home's collections-tile grid.
                <View className="flex-row flex-wrap gap-3">
                  {notes.map((note) => (
                    <View key={note.id} style={{ width: "47%" }}>
                      <NoteCard note={note} onDelete={onDeleteNote} />
                      <Pressable
                        accessibilityLabel="Collection actions"
                        onPress={() => onNoteActions(note)}
                        className="absolute right-2 top-2 z-10 h-8 w-8 items-center justify-center rounded-full border border-border bg-card/90"
                      >
                        <MoreVertical size={16} color={t["ink-soft"]} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <EditCollectionSheet collection={collection} visible={showEdit} onClose={() => setShowEdit(false)} />
    </View>
  );
}
