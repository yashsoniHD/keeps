import { createFileRoute, redirect } from "@tanstack/react-router";

// Ask AI is now a global FAB + docked chat overlay (components/ask/AskFab.tsx), not a page.
// This route stays only to redirect old bookmarks/deep links home rather than 404 — and it
// carries `?ask=1` so the home feed opens Clip AI, honouring the original intent of the link.
export const Route = createFileRoute("/ask")({
  beforeLoad: () => {
    throw redirect({ to: "/", search: { ask: true } });
  },
});
