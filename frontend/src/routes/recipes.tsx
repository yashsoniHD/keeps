import { createFileRoute, redirect } from "@tanstack/react-router";

// Recipes was one of the mini-apps folded back into notes (see CLAUDE.md "notes-first
// collapse"). Its list/detail children are gone; this bare layout route stays only to redirect
// old bookmarks/deep links to Collections rather than 404 (mirrors routes/ask.tsx,
// routes/library.index.tsx). Child paths like /recipes/abc no longer have a matching route
// (recipes.index.tsx / recipes.$itemId.tsx were deleted), so they fall through to the root
// notFoundComponent instead of hitting this redirect — acceptable since it's a dead deep link
// either way.
export const Route = createFileRoute("/recipes")({
  beforeLoad: () => {
    throw redirect({ to: "/collections" });
  },
});
