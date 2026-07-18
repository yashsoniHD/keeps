import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BookmarkPlus, Sparkles } from "lucide-react-native";
import type { Note } from "@clipnote/shared";
import { formatDate, interopIcon, noteAccent, noteIcon } from "@/lib/note-meta";
import { getNote } from "@/lib/firestore";
import { saveSharedNote, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";
import { NoteContent, resolveTemplate } from "@/components/note/NoteContent";
import { SmartImage } from "@/components/note/SmartImage";
import { TypeBadge } from "@/components/note/TypeBadge";
import { SourcePill } from "@/components/note/SourcePill";
import { Glyph } from "@/components/note/Glyph";
import { useAccentColors, useTokens } from "@/components/note/colors";

[BookmarkPlus, Sparkles].forEach(interopIcon);

// Gradient + faded type-icon stand-in so the public view never reads as empty (port of the
// owner detail screen's CoverFallback).
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

// Public, login-free view of a shared note (the universal-link target for
// https://clipnote.web.app/p/{id}). Reads via the same path web's p.$noteId.tsx uses — a plain
// getNote gated on is_public === true, NOT the owner-scoped read the detail screen does; a
// missing / private / permission-denied note all collapse to the same "not available" screen so
// we never reveal whether an id exists. A signed-in viewer can save a copy to their own notes.
export default function PublicNoteScreen() {
  const { noteId: raw } = useLocalSearchParams<{ noteId: string }>();
  const noteId = String(raw);
  const { user } = useAuth();
  const router = useRouter();
  const t = useTokens();

  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getNote(noteId)
      .then((n) => {
        if (!active) return;
        if (n && n.is_public === true) {
          setNote(n);
          setStatus("ready");
        } else {
          setStatus("unavailable");
        }
      })
      .catch(() => active && setStatus("unavailable"));
    return () => {
      active = false;
    };
  }, [noteId]);

  const isOwner = !!(user && note && note.user_id === user.uid);

  // Save the shared note into the viewer's own account, then open their (private) copy.
  // saveSharedNote returns the original id when it's already theirs, so the owner path just
  // opens the note in place.
  const onSave = useCallback(async () => {
    if (!user || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { id } = await saveSharedNote(noteId);
      router.replace(`/note/${id}`);
    } catch (err) {
      setSaving(false);
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save the note. Please try again.");
    }
  }, [user, saving, noteId, router]);

  if (status === "loading") {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1 items-center justify-center">
          <ActivityIndicator color={t.ink} />
        </SafeAreaView>
      </View>
    );
  }

  if (status === "unavailable" || !note) {
    return (
      <View className="flex-1 bg-paper">
        <SafeAreaView className="flex-1 items-center justify-center gap-4 px-8">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-ink">
            <Sparkles size={24} className="text-paper" />
          </View>
          <Text className="text-center text-ink-soft">
            This note isn&rsquo;t available. It may be private or removed.
          </Text>
          <Pressable onPress={() => router.replace("/")} className="mt-1">
            <Text className="text-summary">Go to Clipnote</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  const saveLabel = isOwner ? "Go to note" : "Save to my notes";

  return (
    <View className="flex-1 bg-paper">
      <SafeAreaView className="flex-1" edges={["top"]}>
        <ScrollView contentContainerClassName="px-5 pb-16 pt-4 gap-6">
          {/* Save-this bar, visible before any scroll (port of web PublicSaveBar). */}
          <View className="flex-row items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            <Text className="flex-1 text-sm text-ink-soft">Save this note to your Clipnote.</Text>
            <Pressable
              onPress={onSave}
              disabled={saving}
              accessibilityLabel={saveLabel}
              className="flex-row items-center gap-2 rounded-full bg-ink px-4 py-2.5 active:opacity-80 disabled:opacity-60"
            >
              {saving ? (
                <ActivityIndicator size="small" color={t.paper} />
              ) : (
                <BookmarkPlus size={16} className="text-paper" />
              )}
              <Text className="text-sm font-medium text-paper">{saving ? "Saving…" : saveLabel}</Text>
            </Pressable>
          </View>
          {saveError ? <Text className="text-sm text-destructive">{saveError}</Text> : null}

          {/* Meta: type chip · source · date, then title + lede (read-only, no owner controls). */}
          <View className="gap-4">
            <View className="flex-row flex-wrap items-center gap-2">
              <TypeBadge type={note.content_type} size="md" />
              <SourcePill domain={note.source_domain} url={note.source_url} />
              <Text className="text-xs text-ink-soft">{formatDate(note.created_at)}</Text>
            </View>
            <Text className="font-serif text-3xl leading-tight text-ink">{note.title}</Text>
            {note.ai_summary ? (
              <Text className="text-base leading-relaxed text-ink-soft">{note.ai_summary}</Text>
            ) : null}
          </View>

          {/* Cover hero — Product renders its own image, so skip the shared hero (web parity). */}
          {resolveTemplate(note) !== "product" ? (
            <SmartImage uri={note.cover_image_url} fallback={<CoverFallback note={note} />} />
          ) : null}

          {/* Read-only body — no onPatch, so the GenericNote body stays non-editable. */}
          <NoteContent note={note} />

          {/* Bottom conversion prompt (port of web PublicSignupCTA). */}
          <View className="mt-6 gap-3 rounded-3xl border border-border bg-card p-6">
            <Text className="font-serif text-xl text-ink">Made with Clipnote</Text>
            <Text className="text-sm text-ink-soft">
              Turn any link (recipe, reel, product, article) into a structured note like this.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
