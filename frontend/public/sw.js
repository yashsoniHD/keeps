// Minimal service worker: required for PWA installability (which puts Clipnote in the
// OS share sheet via the manifest's share_target). Network-first passthrough — Firestore
// handles its own offline cache; we don't want stale app shells.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
