import "./lib/storage-migrate";
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

// iOS only applies :active press styles when a touchstart listener exists.
document.addEventListener("touchstart", () => {}, { passive: true });

if ("serviceWorker" in navigator) {
  // Installability (and thus the OS share-sheet entry) requires a registered SW.
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // A long-suspended installed app checks for a new deploy when it comes back.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      })
      .catch(() => {});
    // A new SW took over (a deploy landed): offer a reload instead of a surprise one later.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || document.querySelector(".update-banner")) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "update-banner";
      b.textContent = "New version available. Tap to refresh";
      b.onclick = () => window.location.reload();
      document.body.appendChild(b);
    });
  });
}

const router = getRouter();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
