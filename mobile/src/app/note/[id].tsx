import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { formatDate, noteAccent, noteIcon } from "@/lib/note-meta";
import { getNote, getAnnotation, watchJob } from "@/lib/firestore";
import { deleteNote, reextractNote, shareNote, unshareNote, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { feedNeighbors } from "@/lib/note-nav";
import { NoteContent, resolveTemplate } from "@/components/note/NoteContent";
import { SmartImage } from "@/components/note/SmartImage";
import { SourcePill } from "@/components/note/SourcePill";
import { CategoryEditor } from "@/components/note/CategoryEditor";
import { EditableTitle } from "@/components/note/EditableTitle";
import { ThoughtsBlock } from "@/components/note/ThoughtsBlock";
import { Glyph } from "@/components/note/Glyph";
import { useAccentColors, useTokens } from "@/components/note/colors";

// The public share base — universal links to https://clipnote.web.app/p/{id} open this app
// (see app.json associatedDomains) and resolve to the /p/[noteId] screen.
const PUBLIC_WEB_BASE = "https://clipnote.web.app";

// Gradient + faded type-icon stand-in so the detail view never reads as empty — the accent
// system the feed cards use, scaled up. Port of web CoverFallback (the CSS gradient overlay is
// approximated by the soft accent wash; a true gradient is deferred).
function CoverFallback({ note }: { note: Note }) {
  const accent = noteAccent(note.content_type);
  const { main } = useAccentColors(note.content_type);
  return (
    <View
      className={`h-56 w-full items-center justify-center overflow-hidden rounded-3xl border border-border ${accent.soft}`}
    >
      <View style={{ opacity: 0.4 }}>
        <Glyph icon={noteIcon(note.content_type)} size={88} color={main} />
      </View>
    </View>
  );
}

const GENERIC_REEXTRACT_FAILURE = "Re-extract failed. Your note was left unchanged.";

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const noteId = String(id);
  const { user } = useAuth();
  const router = useRouter();
  const t = useTokens();

  // `note`/`notFoundId` are tagged with the id they belong to, so a navigation to a neighbour
  // (router.replace, same screen instance) is treated as loading without a synchronous state
  // reset inside the effect (which would trigger cascading renders). setState only runs from the
  // async fetch resolution — the pattern the react-hooks rules allow.
  const [note, setNote] = useState<Note | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [reextracting, setReextracting] = useState(false);
  // Bumped to force a re-read of the note in place (after a re-extract completes).
  const [reloadTick, setReloadTick] = useState(0);
  const reextractUnsub = useRef<null | (() => void)>(null);

  // One-time read (matches web — the detail view reads once, it doesn't live-subscribe). The
  // owner's private annotation lives in a separate doc; merge it on so Thoughts can show it. The
  // fetch lives inside the effect as an async closure (setState behind `await`), with an `active`
  // guard so a stale load from a previous id can't overwrite the current one.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const n = await getNote(noteId).catch(() => null);
      if (!active) return;
      if (!n || n.user_id !== user.uid) {
        setNotFoundId(noteId);
        return;
      }
      const userNote = await getAnnotation(noteId).catch(() => "");
      if (active) setNote({ ...n, user_note: userNote });
    })();
    return () => {
      active = false;
    };
  }, [user, noteId, reloadTick]);

  useEffect(() => () => reextractUnsub.current?.(), []);

  // Only the currently-routed note counts; a stale load from the previous id is ignored.
  const currentNote = note && note.id === noteId ? note : null;
  const notFound = notFoundId === noteId;

  // Optimistic in-place patch — the edit affordances (title, category, thoughts, body) flow
  // their local changes back up so the view reflects them before the backend round-trip lands.
  const onPatch = useCallback(
    (patch: Partial<Note>) => {
      setNote((n) => (n && n.id === noteId ? { ...n, ...patch } : n));
    },
    [noteId],
  );

  const { prev, next } = useMemo(() => feedNeighbors(noteId), [noteId]);
  const goToNeighbor = (id?: string) => {
    if (id) router.replace(`/note/${id}`);
  };

  // Re-extract: re-run the source, watch the job, reload the note in place on completion. Disabled
  // while running so a repeat tap can't queue a second job (each burns a daily ingest-cap slot).
  const onReextract = useCallback(async () => {
    if (!user || reextracting || !currentNote?.source_url) return;
    setReextracting(true);
    try {
      const { job_id } = await reextractNote(noteId);
      reextractUnsub.current?.();
      reextractUnsub.current = watchJob(job_id, async (job) => {
        if (job.status !== "completed" && job.status !== "failed") return;
        reextractUnsub.current?.();
        reextractUnsub.current = null;
        setReextracting(false);
        if (job.status === "completed") setReloadTick((n) => n + 1);
        else Alert.alert("Re-extract failed", GENERIC_REEXTRACT_FAILURE);
      });
    } catch (err) {
      setReextracting(false);
      Alert.alert(
        "Re-extract failed",
        err instanceof ApiError ? err.message : GENERIC_REEXTRACT_FAILURE,
      );
    }
  }, [user, reextracting, currentNote, noteId]);

  // Share to web: make the note public (idempotent) then open the native share sheet with the
  // /p/{id} link anyone can open. Reflects is_public optimistically so the menu flips to the
  // "Stop sharing" affordance. Port of web ShareButton.
  const onSharePublic = useCallback(async () => {
    if (!currentNote) return;
    try {
      const { url } = await shareNote(noteId);
      onPatch({ is_public: true });
      await Share.share({ message: url, url, title: currentNote.title }).catch(() => {});
    } catch (err) {
      Alert.alert(
        "Couldn't share",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    }
  }, [currentNote, noteId, onPatch]);

  // Share the link again for an already-public note (no round-trip needed).
  const onShareExistingLink = useCallback(async () => {
    if (!currentNote) return;
    const url = `${PUBLIC_WEB_BASE}/p/${noteId}`;
    await Share.share({ message: url, url, title: currentNote.title }).catch(() => {});
  }, [currentNote, noteId]);

  const onStopSharing = useCallback(async () => {
    try {
      await unshareNote(noteId);
      onPatch({ is_public: false });
    } catch (err) {
      Alert.alert(
        "Couldn't make private",
        err instanceof ApiError ? err.message : "Please try again.",
      );
    }
  }, [noteId, onPatch]);

  const onDelete = useCallback(() => {
    Alert.alert("Delete note", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteNote(noteId);
            router.back();
          } catch (err) {
            Alert.alert(
              "Couldn't delete",
              err instanceof ApiError ? err.message : "Please try again.",
            );
          }
        },
      },
    ]);
  }, [noteId, router]);

  // Share button → Alert action sheet. Web's ShareButton flips is_public + hands out the /p/{id}
  // link, with a "Make private" affordance once public; the same two paths live here as sheet
  // actions so the circular Share button stays a single tap on mobile.
  const openShareSheet = useCallback(() => {
    if (!currentNote) return;
    const buttons: Parameters<typeof Alert.alert>[2] = [];
    if (currentNote.is_public) {
      buttons.push({ text: "Share link", onPress: onShareExistingLink });
      buttons.push({ text: "Stop sharing", style: "destructive", onPress: onStopSharing });
    } else {
      buttons.push({ text: "Share to web", onPress: onSharePublic });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(
      "Share note",
      currentNote.is_public
        ? "This note is public — anyone with the link can read it."
        : "Publish this note to share a public link anyone can open.",
      buttons,
    );
  }, [currentNote, onSharePublic, onShareExistingLink, onStopSharing]);

  if (notFound) {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1 items-center justify-center gap-3 px-8">
          <Text className="font-serif text-2xl text-ink">Note not found</Text>
          <Text className="text-center text-ink-soft">
            This note doesn&rsquo;t exist or was deleted.
          </Text>
          <Pressable onPress={() => router.back()} className="mt-2">
            <Text className="text-summary">Go back</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (!currentNote) {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1 items-center justify-center">
          <ActivityIndicator color={t.ink} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Header: "← Back" on the left, the four circular actions on the right — a port of web
            NoteActions (Ask · Re-extract · Share · Delete). */}
        <View className="flex-row items-center justify-between px-4 py-2">
          <Pressable
            accessibilityLabel="Back"
            onPress={() => router.back()}
            className="flex-row items-center gap-1.5 py-1 pr-3 active:opacity-60"
          >
            <ChevronLeft size={18} color={t["ink-soft"]} />
            <Text className="text-sm text-ink-soft">Back</Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            {/* Ask AI about this note — not wired on mobile yet (TODO), shown disabled. */}
            <View
              accessibilityLabel="Ask about this note"
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card opacity-50"
            >
              <Sparkles size={18} color={t.summary} />
            </View>
            {currentNote.source_url ? (
              <Pressable
                accessibilityLabel={reextracting ? "Re-extracting" : "Re-extract note"}
                disabled={reextracting}
                onPress={onReextract}
                className={`h-10 w-10 items-center justify-center rounded-full border active:opacity-60 ${
                  reextracting ? "border-ink bg-ink" : "border-border bg-card"
                }`}
              >
                {reextracting ? (
                  <ActivityIndicator size="small" color={t.paper} />
                ) : (
                  <RefreshCw size={18} color={t["ink-soft"]} />
                )}
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="Share note"
              onPress={openShareSheet}
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:opacity-60"
            >
              <Share2 size={18} color={t["ink-soft"]} />
            </Pressable>
            <Pressable
              accessibilityLabel="Delete note"
              onPress={onDelete}
              className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:opacity-60"
            >
              <Trash2 size={18} color={t["ink-soft"]} />
            </Pressable>
          </View>
        </View>

        {reextracting && (
          <View className="flex-row items-center gap-2 border-b border-border bg-muted px-5 py-2">
            <ActivityIndicator size="small" color={t["ink-soft"]} />
            <Text className="text-xs text-ink-soft">Re-extracting from the source…</Text>
          </View>
        )}

        <ScrollView contentContainerClassName="px-5 pb-16 pt-4 gap-6">
          {/* Meta: editable category chip · source · date, then editable title + lede. */}
          <View className="gap-4">
            <View className="flex-row flex-wrap items-center gap-2">
              <CategoryEditor
                type={currentNote.content_type}
                noteId={currentNote.id}
                onPatch={onPatch}
              />
              <SourcePill domain={currentNote.source_domain} url={currentNote.source_url} />
              <Text className="text-xs text-ink-soft">{formatDate(currentNote.created_at)}</Text>
            </View>
            <EditableTitle note={currentNote} onPatch={onPatch} />
            {currentNote.ai_summary ? (
              <Text className="text-base leading-relaxed text-ink-soft">
                {currentNote.ai_summary}
              </Text>
            ) : null}
          </View>

          {/* Cover hero — measured cover or the gradient + type-icon fallback. Product
              renders its own image inside ProductNote, so skip the shared hero (web parity). */}
          {resolveTemplate(currentNote) !== "product" ? (
            <SmartImage
              uri={currentNote.cover_image_url}
              fallback={<CoverFallback note={currentNote} />}
            />
          ) : null}

          {/* Template body (safe render ladder). onPatch wires the editable GenericNote body. */}
          <NoteContent note={currentNote} onPatch={onPatch} />

          {/* Owner's private annotation — editable, debounced autosave via updateNote. */}
          <ThoughtsBlock noteId={currentNote.id} value={currentNote.user_note ?? ""} onPatch={onPatch} />

          {/* In-flow footer nav to the neighbouring notes in the feed order the user came from
              (port of the web note route's footer nav). */}
          {(prev || next) && (
            <View className="flex-row items-center justify-between border-t border-border pt-5">
              {prev ? (
                <Pressable
                  accessibilityLabel="Previous note"
                  onPress={() => goToNeighbor(prev)}
                  className="flex-row items-center gap-1.5 py-2 active:opacity-60"
                >
                  <ChevronLeft size={16} color={t["ink-soft"]} />
                  <Text className="text-sm text-ink-soft">Previous</Text>
                </Pressable>
              ) : (
                <View />
              )}
              {next ? (
                <Pressable
                  accessibilityLabel="Next note"
                  onPress={() => goToNeighbor(next)}
                  className="flex-row items-center gap-1.5 py-2 active:opacity-60"
                >
                  <Text className="text-sm text-ink-soft">Next</Text>
                  <ChevronRight size={16} color={t["ink-soft"]} />
                </Pressable>
              ) : (
                <View />
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
