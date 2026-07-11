import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for /trips and /trips/$itemId. With both a list and a detail route under
// "trips", this parent must render an <Outlet/> (mirrors recipes.tsx) — the list lives in
// trips.index.tsx and the trip detail in trips.$itemId.tsx.
export const Route = createFileRoute("/trips")({ component: () => <Outlet /> });
