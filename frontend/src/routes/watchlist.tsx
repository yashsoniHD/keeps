import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for /watchlist and /watchlist/$itemId. With both a list and a detail route
// under "watchlist", this parent must render an <Outlet/> (mirrors library.tsx) — the list lives
// in watchlist.index.tsx and the movie detail in watchlist.$itemId.tsx.
export const Route = createFileRoute("/watchlist")({ component: () => <Outlet /> });
