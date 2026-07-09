/**
 * Service worker for NBA Re-Draft — network-first with cache fallback.
 *
 * Strategy: always try the network (so deploys show up immediately) and stash
 * every successful same-origin response; when offline, serve from the cache.
 * The ?v= query strings on assets keep cache entries version-keyed.
 */
const CACHE = "nbaredraft-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin (app shell + assets); let CDNs/Firebase pass through.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(
          (hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined)
        )
      )
  );
});
