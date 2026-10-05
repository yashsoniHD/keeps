// Replaces the old app's service worker on clipnote.web.app: clears its caches,
// unregisters itself, and sends open windows to the new site.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) await caches.delete(k);
      await self.registration.unregister();
      for (const c of await self.clients.matchAll({ type: "window" })) {
        const u = new URL(c.url);
        c.navigate("https://keeps.web.app" + u.pathname + u.search);
      }
    })(),
  );
});
