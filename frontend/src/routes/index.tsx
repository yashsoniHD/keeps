import { createFileRoute } from "@tanstack/react-router";
import { Library } from "@/keeps/Library";

// Home is the Keeps library. The active category lives in the URL (?type=...) so opening a
// note and coming back keeps the filter.
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { type?: string } => ({
    type: typeof search.type === "string" ? search.type : undefined,
  }),
  component: Home,
});

function Home() {
  const { type } = Route.useSearch();
  return <Library typeParam={type} />;
}
