// Minimal service worker: required for PWA installability (which puts Clipnote in the
// OS share sheet via the manifest's share_target). Network-first passthrough — Firestore
// handles its own offline cache; we don't want stale app shells.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // iOS Safari mishandles file downloads that pass through respondWith (saves them as
  // .html) — let the browser handle the .shortcut file natively.
  if (new URL(event.request.url).pathname.endsWith(".shortcut")) return;
  event.respondWith(fetch(event.request));
});
