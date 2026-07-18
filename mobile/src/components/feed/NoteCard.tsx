import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Star, Pin } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";

// className styling on SVG icons requires interop registration (see note-meta).
[Star, Pin].forEach(interopIcon);
import { useRouter } from "expo-router";
import type { Note } from "@clipnote/shared";
import { formatDateShort, noteLabel, sourceLabel } from "@clipnote/shared";
import { noteAccent, noteIcon } from "@/lib/note-meta";

// Footer label for a note with no web source (typed note / uploaded image or PDF / Clip AI).
// Mirrors the web NoteCard's savedLabel so the footer always reads something meaningful.
function savedLabel(note: Note): string {
  switch (note.input_type) {
    case "image":
      return "Image";
    case "pdf":
      return "PDF";
    case "text":
      return "Note";
    case "voice":
      return "Voice";
    case "video":
      return "Video";
    default:
      return note.source === "ai" ? "Clip AI" : "Saved";
  }
}

// A single feed card, ported from the web NoteCard's default Card variant but reshaped for
// touch: an image-forward cover on top (with an accent-tinted, type-icon fallback tile when
// the note is coverless — so a feed of tiles never reads as dead boxes), then the type chip,
// title, summary and a source/date footer. Tap opens the note; long-press offers Delete.
export function NoteCard({ note, onDelete }: { note: Note; onDelete: (note: Note) => void }) {
  const router = useRouter();
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const [broken, setBroken] = useState(false);
  const hasCover = Boolean(note.cover_image_url) && !broken;

  const confirmDelete = () => {
    Alert.alert("Delete note?", note.title || "This note will be removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(note) },
    ]);
  };

  return (
    <Pressable
      onPress={() => router.push(`/note/${note.id}`)}
      onLongPress={confirmDelete}
      className="overflow-hidden rounded-2xl border border-border bg-card active:opacity-90"
    >
      {/* Cover: real image when present, otherwise an accent-washed tile with the type icon. */}
      {hasCover ? (
        <Image
          source={{ uri: note.cover_image_url! }}
          contentFit="cover"
          transition={200}
          onError={() => setBroken(true)}
          style={{ width: "100%", aspectRatio: 16 / 9 }}
        />
      ) : (
        <View
          className={`w-full items-center justify-center border-b ${accent.wash}`}
          style={{ aspectRatio: 16 / 9 }}
        >
          <Icon size={40} className={accent.text} strokeWidth={1.5} />
        </View>
      )}

      <View className="p-4">
        <View className="flex-row items-center justify-between gap-2">
          <View
            className={`flex-row items-center gap-1 self-start rounded-full px-2.5 py-1 ${accent.chip}`}
          >
            <Icon size={13} className={accent.text} />
            <Text className={`text-xs font-medium ${accent.text}`} numberOfLines={1}>
              {noteLabel(note.content_type)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            {note.pinned_at && <Pin size={12} className="text-ink-soft" fill="currentColor" />}
            {note.is_favorite && <Star size={12} className="text-favorite" fill="currentColor" />}
            <Text className="text-[11px] text-ink-soft">{formatDateShort(note.created_at)}</Text>
          </View>
        </View>

        <Text className="mt-3 text-xl font-semibold leading-tight text-ink" numberOfLines={2}>
          {note.title}
        </Text>
        {note.ai_summary ? (
          <Text className="mt-1.5 text-sm leading-relaxed text-ink-soft" numberOfLines={3}>
            {note.ai_summary}
          </Text>
        ) : null}

        <View className="mt-3 flex-row items-center">
          <Text className="flex-1 text-[11px] capitalize text-ink-soft" numberOfLines={1}>
            {note.source_domain ? sourceLabel(note.source_domain) : savedLabel(note)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
