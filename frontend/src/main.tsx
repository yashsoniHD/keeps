import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/instrument-serif/400.css";

// Routes are lazy-loaded chunks with hashed names; after a redeploy, an open tab
// still holds the old index.html and its chunk requests 404 — navigation then fails
// silently (e.g. the Settings gear "does nothing"). Reload to pick up the new build.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  window.location.reload();
});

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
