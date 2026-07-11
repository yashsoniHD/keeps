import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for /recipes and /recipes/$itemId. With both a list and a detail route under
// "recipes", this parent must render an <Outlet/> (mirrors wishlist.tsx) — the list lives in
// recipes.index.tsx and the recipe detail in recipes.$itemId.tsx.
export const Route = createFileRoute("/recipes")({ component: () => <Outlet /> });
