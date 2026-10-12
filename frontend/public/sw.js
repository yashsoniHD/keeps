// Minimal service worker: required for PWA installability (which puts Keeps in the
// OS share sheet via the manifest's share_target). It handles the share POST, caches hashed
// static assets, and serves navigations network-first with a cached index.html fallback so
// the installed app opens offline. API, Firestore and images are not intercepted.
// Replaced with a per-deploy hash by vite.config.ts (swBuildStamp), so every deploy changes
// this file: the browser installs the new SW, activate prunes the previous build's caches, and
// main.tsx offers a refresh. The dev server serves the placeholder as-is.
const BUILD = "__BUILD__";
// The build's /assets/* paths (also filled in by swBuildStamp; empty on the dev server).
const ASSETS = /*__ASSETS__*/ [];
const SHARE_CACHE = "keeps-shared";
const STATIC_CACHE = `keeps-static-${BUILD}`;
const SHELL_CACHE = `keeps-shell-${BUILD}`;

// Precache this build's shell and every asset before taking over: activate prunes the previous
// build's caches, so an offline launch must find everything here. If any fetch fails, install
// fails and the old SW (with its complete caches) stays in control.
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((c) => c.add(new Request("/index.html", { cache: "reload" }))),
      caches.open(STATIC_CACHE).then((c) => c.addAll(ASSETS)),
    ]).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHARE_CACHE && k !== STATIC_CACHE && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
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
  // Hosting rewrites a missing chunk to index.html (200); never cache that as the asset.
  if (res.ok && !res.headers.get("content-type")?.includes("text/html"))
    cache.put(request, res.clone());
  return res;
}

// Navigations: always the network while online (no stale shell); the cached index.html only
// when the network fails, so the app (and the offline capture queue) still opens offline.
async function navigate(request) {
  try {
    const res = await fetch(request);
    if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
      const copy = res.clone();
      caches.open(SHELL_CACHE).then((c) => c.put("/index.html", copy));
    }
    return res;
  } catch (err) {
    const hit = await caches.match("/index.html", { cacheName: SHELL_CACHE });
    if (hit) return hit;
    throw err;
  }
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
    return;
  }
  if (event.request.mode === "navigate" && event.request.method === "GET") {
    event.respondWith(navigate(event.request));
  }
  // Anything else falls through untouched (no respondWith).
});
