import { createFileRoute, redirect } from "@tanstack/react-router";

// Ask AI is now a global FAB + docked chat overlay (components/ask/AskFab.tsx), not a page.
// This route stays only to redirect old bookmarks/deep links home rather than 404.
export const Route = createFileRoute("/ask")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
