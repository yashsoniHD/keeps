import { View, Text } from "react-native";
import * as Linking from "expo-linking";
import type { Note } from "@clipnote/shared";
import { ErrorBoundary } from "./ErrorBoundary";
import { RecipeNote } from "./templates/RecipeNote";
import { SummaryNote } from "./templates/SummaryNote";
import { GenericNote } from "./templates/GenericNote";
import { ProductNote } from "./templates/ProductNote";
import { WorkoutNote } from "./templates/WorkoutNote";
import { BookNote } from "./templates/BookNote";
import { PlaceNote } from "./templates/PlaceNote";
import { WatchNote } from "./templates/WatchNote";
import { ItineraryNote } from "./templates/ItineraryNote";

// Which bespoke template a note's `data` map was built for. STRUCTURAL fact about the data
// shape — never follows the user-editable `content_type`. Ported EXACTLY from
// frontend/src/components/NoteContent.tsx resolveTemplate.
export function resolveTemplate(note: Note): string {
  const data = (note.data ?? {}) as Record<string, unknown>;
  // Entertainment resolves on data shape FIRST (its content_type slug is open, but a `titles[]`
  // of objects is emitted only by the entertainment extraction schema).
  if (Array.isArray(data.titles) && data.titles.length > 0 && typeof data.titles[0] === "object")
    return "entertainment";
  if (note.template) return note.template;
  if (Array.isArray(data.ingredients)) return "recipe";
  if (Array.isArray(data.days)) return "itinerary";
  if (Array.isArray(data.exercises) || (data.structure && data.goal)) return "workout";
  if (data.specs || data.pros || data.cons || data.buyUrl || (data.price && data.brand))
    return "product";
  if (data.tldr || Array.isArray(data.keyPoints)) return "summary";
  if (Array.isArray(data.venues)) return "place";
  if (Array.isArray(data.highlights) && (data.location || data.timings)) return "place";
  if (data.premise || data.whoShouldRead || Array.isArray(data.keyIdeas)) return "book";
  return ""; // generic blocks (facts/sections/steps/table/checklist/quotes)
}

function NoteBody({ note, onPatch }: { note: Note; onPatch?: (patch: Partial<Note>) => void }) {
  switch (resolveTemplate(note)) {
    case "recipe":
      return <RecipeNote note={note} />;
    case "summary":
      return <SummaryNote note={note} />;
    case "product":
      return <ProductNote note={note} />;
    case "workout":
      return <WorkoutNote note={note} />;
    case "book":
      return <BookNote note={note} />;
    case "place":
      return <PlaceNote note={note} />;
    case "entertainment":
      return <WatchNote note={note} />;
    case "itinerary":
      return <ItineraryNote note={note} />;
    default:
      // AI-invented types + save-as-is typed notes, whose editable `body` block GenericNote
      // renders when onPatch is wired (owner view only).
      return <GenericNote note={note} onPatch={onPatch} />;
  }
}

// Last rung of the fallback ladder: title + summary are plain strings, so this can't throw on
// any data shape. The reader still gets the source link. Port of web's PlainBody.
function PlainBody({ note }: { note: Note }) {
  return (
    <View className="rounded-2xl border border-border bg-card p-5">
      <Text className="text-sm leading-relaxed text-ink-soft">
        This note&rsquo;s details couldn&rsquo;t be displayed
        {note.source_url ? "; " : "."}
        {note.source_url && (
          <Text
            className="text-summary underline"
            onPress={() => Linking.openURL(note.source_url).catch(() => {})}
          >
            open the original
          </Text>
        )}
        {note.source_url ? " instead." : ""}
      </Text>
    </View>
  );
}

// AI-shaped data hitting typed templates is the riskiest render path in the app. The ladder
// degrades per-note instead of white-screening: typed template → GenericNote (renders any block
// shape) → plain card. Port of web's SafeNoteBody.
export function NoteContent({
  note,
  onPatch,
}: {
  note: Note;
  onPatch?: (patch: Partial<Note>) => void; // owner-only; undefined on the public view
}) {
  return (
    <ErrorBoundary
      label={`template:${note.content_type}`}
      fallback={
        <ErrorBoundary label="template:generic-fallback" fallback={<PlainBody note={note} />}>
          <GenericNote note={note} />
        </ErrorBoundary>
      }
    >
      <NoteBody note={note} onPatch={onPatch} />
    </ErrorBoundary>
  );
}
