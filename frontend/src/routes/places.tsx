import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for /places and /places/$itemId. With both a list and a detail route under
// "places", this parent must render an <Outlet/> (mirrors watchlist.tsx / wishlist.tsx) — the
// list lives in places.index.tsx and the venue detail in places.$itemId.tsx.
export const Route = createFileRoute("/places")({ component: () => <Outlet /> });
