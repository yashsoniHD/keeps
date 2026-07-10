import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "./notes.index";

// Notes-first home: the feed IS the front door. Feed's `home` variant wears the brand header
// (ClipMark + wordmark, search / new / settings) above the note stream. The active category
// lives in the URL (?type=…) so opening a note and coming back keeps the filter.
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { type?: string } => ({
    type: typeof search.type === "string" ? search.type : undefined,
  }),
  component: Home,
});

function Home() {
  const { type } = Route.useSearch();
  return <Feed home typeParam={type} />;
}
