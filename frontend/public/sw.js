// Minimal service worker: required for PWA installability (which puts Keeps in the
// OS share sheet via the manifest's share_target). It only handles the share POST and
// caches hashed static assets. Everything else (index.html, API, Firestore, images) is not
// intercepted at all, so it goes network-direct with no SW hop and no stale app shell.
const SHARE_CACHE = "keeps-shared";
const STATIC_CACHE = "keeps-static-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHARE_CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);

// Where a shared payload (url/text/title) is parked between the POST share and the /share
// page reading it. The SW catches the POST, stashes the payload in the Cache, and redirects to
// a GET the page can read. Cache (not an in-memory map) so the payload survives if the SW
// restarts or the user has to sign in first.
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

// Vite's /assets/* files are content-hashed, so cache-first is always correct for them.
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // API, Firestore, CDNs: network-direct

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
  if (event.request.method === "GET" && url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(event.request));
  }
  // Anything else falls through untouched (no respondWith).
});
