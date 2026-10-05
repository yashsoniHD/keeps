import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";
import "./keeps/keeps.css";
import "./keeps/motion.css";

// Routes are lazy-loaded chunks with hashed names; after a redeploy, an open tab
// still holds the old index.html and its chunk requests 404 — navigation then fails
// silently (e.g. the Settings gear "does nothing"). Reload to pick up the new build.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  window.location.reload();
});

// Browser errors are invisible to ops otherwise — ship them to the backend sink
// (shared with the render ErrorBoundary; see lib/client-errors.ts).
import { reportClientError } from "./lib/client-errors";

window.addEventListener("error", (e) => reportClientError("error", e.message, e.error?.stack));
window.addEventListener("unhandledrejection", (e) =>
  reportClientError(
    "unhandledrejection",
    (e.reason as Error)?.message ?? e.reason,
    (e.reason as Error)?.stack,
  ),
);

if ("serviceWorker" in navigator) {
  // Installability (and thus the OS share-sheet entry) requires a registered SW.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const router = getRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
