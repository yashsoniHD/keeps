import type { Note } from "@/lib/types";
import { NoteHeader } from "./note/NoteHeader";
import { AISummaryBlock } from "./note/AISummaryBlock";
import { RecipeNote } from "./note/templates/RecipeNote";
import { ItineraryNote } from "./note/templates/ItineraryNote";
import { ProductNote } from "./note/templates/ProductNote";
import { SummaryNote } from "./note/templates/SummaryNote";
import { WorkoutNote } from "./note/templates/WorkoutNote";
import { GenericNote } from "./note/templates/GenericNote";

function NoteBody({ note }: { note: Note }) {
  switch (note.content_type) {
    case "recipe":
      return <RecipeNote note={note} />;
    case "itinerary":
      return <ItineraryNote note={note} />;
    case "product":
      return <ProductNote note={note} />;
    case "summary":
      return <SummaryNote note={note} />;
    case "workout":
      return <WorkoutNote note={note} />;
    default:
      return <GenericNote note={note} />; // any AI-invented type
  }
}

export function NoteContent({ note, onDelete }: { note: Note; onDelete?: () => void }) {
  // ProductNote lays out its own image beside the buy panel.
  const showCover = note.cover_image_url && note.content_type !== "product";
  return (
    <article className="mx-auto max-w-4xl px-5 py-8 md:px-8 md:py-14">
      <NoteHeader note={note} onDelete={onDelete} />
      {showCover && (
        <div className="mb-8 overflow-hidden rounded-3xl border border-border">
          <img
            src={note.cover_image_url!}
            alt=""
            className="h-72 w-full object-cover md:h-96"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).style.display = "none";
            }}
          />
        </div>
      )}
      <AISummaryBlock summary={note.ai_summary} />
      <div className="mt-8">
        <NoteBody note={note} />
      </div>
    </article>
  );
}
