import { createFileRoute, Outlet } from "@tanstack/react-router";

// Pathless layout for /library and /library/$collectionId — just hosts the child routes via
// <Outlet/>. The Library list itself lives on the home screen (routes/index.tsx); bare /library
// redirects home (library.index.tsx), and /library/$collectionId renders a collection.
export const Route = createFileRoute("/library")({ component: () => <Outlet /> });
