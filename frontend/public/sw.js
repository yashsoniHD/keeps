// Minimal service worker: required for PWA installability (which puts Clipnote in the
// OS share sheet via the manifest's share_target). Network-first passthrough — Firestore
// handles its own offline cache; we don't want stale app shells.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Where a shared payload (url/text/title) is parked between the POST share and the /share
// page reading it. The SW catches the POST, stashes the payload in the Cache, and redirects to
// a GET the page can read. Cache (not an in-memory map) so the payload survives if the SW
// restarts or the user has to sign in first.
const SHARE_CACHE = "clipnote-shared";

async function stashShare(request) {
  const form = await request.formData();
  const id = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const cache = await caches.open(SHARE_CACHE);
  const meta = {
    url: form.get("url") || "",
    text: form.get("text") || "",
    title: form.get("title") || "",
  };
  await cache.put(
    new Request(`/__shared/${id}/meta`),
    new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }),
  );
  return Response.redirect(new URL(`/share?shared=${id}`, self.location.origin).href, 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // The POST share lands here: stash it, then redirect to the readable GET page.
  if (event.request.method === "POST" && url.pathname === "/share") {
    event.respondWith(stashShare(event.request));
    return;
  }
  // The /share page reads its stashed payload (meta) back out of the Cache.
  if (url.pathname.startsWith("/__shared/")) {
    event.respondWith(
      caches
        .open(SHARE_CACHE)
        .then((c) => c.match(event.request))
        .then((r) => r || new Response("", { status: 404 })),
    );
    return;
  }
  // iOS Safari mishandles file downloads that pass through respondWith (saves them as
  // .html) — let the browser handle the .shortcut file natively.
  if (url.pathname.endsWith(".shortcut")) return;
  event.respondWith(fetch(event.request));
});
