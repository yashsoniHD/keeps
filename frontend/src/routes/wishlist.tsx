import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for /wishlist and /wishlist/$itemId. With both a list and a detail route under
// "wishlist", this parent must render an <Outlet/> (mirrors watchlist.tsx) — the list lives in
// wishlist.index.tsx and the product detail in wishlist.$itemId.tsx.
export const Route = createFileRoute("/wishlist")({ component: () => <Outlet /> });
