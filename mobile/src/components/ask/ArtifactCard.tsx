import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BookmarkPlus, Check } from "lucide-react-native";
import { interopIcon } from "@/lib/note-meta";
import { GenericNote } from "@/components/note/templates/GenericNote";
import { augmentNote, saveConsolidatedNote, type AskArtifact } from "@/lib/api";
import type { Note } from "@clipnote/shared";

// className styling on SVG icons requires interop registration (see note-meta).
[BookmarkPlus, Check].forEach(interopIcon);

// A consolidated artifact (itinerary / meal plan / comparison / checklist) rendered with the
// same block renderer as a real note (GenericNote), inside a distinct card. Offers "Save as
// note" and — when the chat is scoped to a focal note — "Add to {note}" (additive merge).
// Deliver-then-offer: the agent never writes; persistence is an explicit tap here. Port of
// web AskChat's ArtifactCard.
export function ArtifactCard({
  artifact,
  sourceIds,
  focalNoteId,
  focalTitle,
}: {
  artifact: AskArtifact;
  sourceIds: string[];
  focalNoteId?: string | null;
  focalTitle?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "added" | "error">("idle");
  const [noteId, setNoteId] = useState<string | null>(null);

  // GenericNote renders from a Note; the artifact carries the same block schema, so present it
  // as a synthetic composed note (template forces the generic renderer).
  const synthetic = useMemo(
    () =>
      ({
        id: "artifact",
        content_type: artifact.content_type,
        template: "composed",
        title: artifact.title,
        ai_summary: artifact.ai_summary,
        data: artifact.data,
        cover_image_url: null,
      }) as unknown as Note,
    [artifact],
  );

  const save = async () => {
    setState("saving");
    try {
      const { id } = await saveConsolidatedNote(artifact, sourceIds);
      setNoteId(id);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const addToNote = async () => {
    if (!focalNoteId) return;
    setState("saving");
    try {
      await augmentNote(focalNoteId, artifact, sourceIds);
      setNoteId(focalNoteId);
      setState("added");
    } catch {
      setState("error");
    }
  };

  const done = state === "saved" || state === "added";

  return (
    <View className="rounded-2xl border border-border bg-card p-5">
      <Text className="text-2xl font-semibold text-ink">{artifact.title}</Text>
      {artifact.ai_summary ? (
        <Text className="mt-1 text-sm text-ink-soft">{artifact.ai_summary}</Text>
      ) : null}
      <View className="mt-5">
        <GenericNote note={synthetic} />
      </View>
      <View className="mt-5 gap-3">
        {done && noteId ? (
          <Pressable
            onPress={() => router.push(`/note/${noteId}`)}
            accessibilityRole="button"
            className="flex-row items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 active:opacity-90"
          >
            <Check size={16} className="text-paper" />
            <Text className="text-sm font-medium text-paper">
              {state === "added" ? "Added. View note" : "Saved. View note"}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={save}
              disabled={state === "saving"}
              accessibilityRole="button"
              className="flex-row items-center justify-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 active:opacity-80"
            >
              {state === "saving" ? (
                <ActivityIndicator size="small" />
              ) : (
                <BookmarkPlus size={16} className="text-ink" />
              )}
              <Text className="text-sm font-medium text-ink">Save as note</Text>
            </Pressable>
            {focalNoteId ? (
              <Pressable
                onPress={addToNote}
                disabled={state === "saving"}
                accessibilityRole="button"
                className="flex-row items-center justify-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 active:opacity-80"
              >
                <BookmarkPlus size={16} className="text-ink" />
                <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                  {focalTitle ? `Add to "${focalTitle}"` : "Add to this note"}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
        {state === "error" ? (
          <Text className="text-sm text-destructive">Couldn't save. Try again.</Text>
        ) : null}
      </View>
    </View>
  );
}
