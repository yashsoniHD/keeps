import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import type { Note } from "@clipnote/shared";
import { formatDateShort, sourceLabel } from "@clipnote/shared";
import { noteAccent, noteIcon } from "@/lib/note-meta";

// A shelf tile mirrors the web's shelf/board card (frontend NoteCard `BoardCard` with the
// Shelves `ratio={4/5}` + `hideCategory` props): a fixed-width portrait card — 4:5 cover on
// top (accent-washed type-icon tile when coverless), then a two-line title and a source row
// (favicon + source label on the left, short date on the right). The shelf header already
// names the category, so the tile drops its own category line.
export const SHELF_CARD_WIDTH = 160;
const COVER_HEIGHT = Math.round((SHELF_CARD_WIDTH * 5) / 4); // 4:5 portrait

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

// Web uses Google's favicon service for the source glyph; match the exact URL pattern so the
// mobile tile shows the same mark. (`sz=32` renders crisp at the 14px display size.)
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

export function ShelfCard({
  note,
  onDelete,
}: {
  note: Note;
  onDelete?: (note: Note) => void;
}) {
  const router = useRouter();
  const accent = noteAccent(note.content_type);
  const Icon = noteIcon(note.content_type);
  const [broken, setBroken] = useState(false);
  const hasCover = Boolean(note.cover_image_url) && !broken;

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert("Delete note?", note.title || "This note will be removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDelete(note) },
    ]);
  };

  return (
    <Pressable
      onPress={() => router.push(`/note/${note.id}`)}
      onLongPress={confirmDelete}
      style={{ width: SHELF_CARD_WIDTH }}
      className="overflow-hidden rounded-2xl border border-border bg-card active:opacity-90"
    >
      {/* Cover: real image when present, otherwise an accent-washed tile with the type icon. */}
      {hasCover ? (
        <Image
          source={{ uri: note.cover_image_url! }}
          contentFit="cover"
          transition={200}
          onError={() => setBroken(true)}
          style={{ width: "100%", height: COVER_HEIGHT }}
        />
      ) : (
        <View
          className={`w-full items-center justify-center ${accent.soft}`}
          style={{ height: COVER_HEIGHT }}
        >
          <Icon size={40} className={accent.text} strokeWidth={1.5} />
        </View>
      )}

      <View className="p-2.5">
        <Text
          className="text-sm font-medium leading-snug text-ink"
          numberOfLines={2}
          style={{ minHeight: 36 }}
        >
          {note.title}
        </Text>

        <View className="mt-1.5 flex-row items-center gap-1.5">
          {note.source_domain ? (
            <>
              <Image
                source={{ uri: faviconUrl(note.source_domain) }}
                contentFit="contain"
                style={{ width: 14, height: 14, borderRadius: 3 }}
              />
              <Text
                className="flex-1 text-[11px] capitalize text-ink-soft"
                numberOfLines={1}
              >
                {sourceLabel(note.source_domain)}
              </Text>
            </>
          ) : (
            <Text
              className="flex-1 text-[11px] capitalize text-ink-soft"
              numberOfLines={1}
            >
              {savedLabel(note)}
            </Text>
          )}
          <Text className="text-[11px] text-ink-soft">{formatDateShort(note.created_at)}</Text>
        </View>
      </View>
    </Pressable>
  );
}
