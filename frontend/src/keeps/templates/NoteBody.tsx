// Picks the purpose-built layout for a note's structural template (same resolution as
// toView). A template that can't read its data falls back to GenericNote itself; one that
// throws is caught here: template -> GenericNote -> PlainNote.
import type { ComponentType } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isRec, resolveTemplate, type R } from "../toView";
import type { NoteView } from "../view";
import type { TemplateProps } from "./parts";
import { BookNote } from "./BookNote";
import { GenericNote, PlainNote } from "./GenericNote";
import { ItineraryNote } from "./ItineraryNote";
import { PlaceNote } from "./PlaceNote";
import { ProductNote } from "./ProductNote";
import { RecipeNote } from "./RecipeNote";
import { SummaryNote } from "./SummaryNote";
import { WatchNote } from "./WatchNote";
import { WorkoutNote } from "./WorkoutNote";
import "../templates.css";

const TEMPLATES: Record<string, ComponentType<TemplateProps>> = {
  recipe: RecipeNote,
  itinerary: ItineraryNote,
  place: PlaceNote,
  entertainment: WatchNote,
  product: ProductNote,
  workout: WorkoutNote,
  summary: SummaryNote,
  book: BookNote,
};

export function NoteBody({ view }: { view: NoteView }) {
  const data: R = isRec(view.note.data) ? view.note.data : {};
  let tpl = "";
  try {
    tpl = resolveTemplate(view.note, data);
  } catch {
    /* odd note shape: generic */
  }
  const known = Object.hasOwn(TEMPLATES, tpl); // not `in`: "constructor" is a valid AI slug
  const Template = known ? TEMPLATES[tpl] : GenericNote;
  const slug = known ? tpl : "generic";
  return (
    <div className={`note-content content-${slug}`}>
      <ErrorBoundary
        label={`keeps-template:${slug}`}
        fallback={
          <ErrorBoundary
            label="keeps-template:generic-fallback"
            fallback={<PlainNote view={view} />}
          >
            <GenericNote view={view} data={data} />
          </ErrorBoundary>
        }
      >
        <Template view={view} data={data} />
      </ErrorBoundary>
    </div>
  );
}
