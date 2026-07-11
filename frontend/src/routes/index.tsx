import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "./notes.index";

// Notes-first home: the feed IS the front door. Feed's `home` variant wears the brand header
// (ClipMark + wordmark, search / new / settings) above the note stream. The active category
// lives in the URL (?type=…) so opening a note and coming back keeps the filter.
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { type?: string; ask?: boolean } => ({
    type: typeof search.type === "string" ? search.type : undefined,
    // `?ask=1` (from old /ask deep links) tells Feed to open Clip AI once.
    ask: search.ask === "1" || search.ask === 1 || search.ask === true ? true : undefined,
  }),
  component: Home,
});

function Home() {
  const { type, ask } = Route.useSearch();
  return <Feed home typeParam={type} openAsk={ask} />;
}
