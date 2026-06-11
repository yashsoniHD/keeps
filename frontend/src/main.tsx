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

// Browser errors are invisible to ops otherwise — ship them to the backend sink
// (logged at ERROR severity in Cloud Logging). Deduped per session, hard-capped.
const reportedErrors = new Set<string>();
function reportClientError(kind: string, message: unknown, stack?: unknown) {
  const msg = String(message ?? "unknown").slice(0, 500);
  const key = `${kind}:${msg}`;
  if (reportedErrors.has(key) || reportedErrors.size >= 10) return;
  reportedErrors.add(key);
  const body = JSON.stringify({
    kind,
    message: msg,
    stack: String(stack ?? "").slice(0, 1000),
    path: window.location.pathname,
    ua: navigator.userAgent.slice(0, 200),
  });
  const endpoint = `${import.meta.env.VITE_API_URL ?? "http://localhost:8080"}/api/client-errors`;
  try {
    if (!navigator.sendBeacon?.(endpoint, body)) {
      fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    /* reporting must never throw */
  }
}
window.addEventListener("error", (e) => reportClientError("error", e.message, e.error?.stack));
window.addEventListener("unhandledrejection", (e) =>
  reportClientError("unhandledrejection", (e.reason as Error)?.message ?? e.reason, (e.reason as Error)?.stack),
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
