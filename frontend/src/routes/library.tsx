import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for /library and /library/$collectionId. Previously this file held the
// Library screen *and* was the parent route of the detail page — but with no <Outlet/> the
// detail route had nowhere to render, so collection folders never opened. The list now lives
// in library.index.tsx; this just hosts the child routes.
export const Route = createFileRoute("/library")({ component: () => <Outlet /> });
