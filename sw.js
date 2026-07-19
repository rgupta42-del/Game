/**
 * Service worker for NBA Re-Draft — network-first with cache fallback.
 *
 * Strategy: always try the network (so deploys show up immediately) and stash
 * every successful same-origin response; when offline, serve from the cache.
 * The ?v= query strings on assets keep cache entries version-keyed.
 */
const CACHE = "nbaredraft-v2";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Claim clients and purge caches from older SW versions — v1 had cached a
  // day-one copy of SongSnap and could resurrect it on flaky connections.
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      ),
    ])
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin (app shell + assets); let CDNs/Firebase pass through.
  if (url.origin !== self.location.origin) return;
  // SongSnap manages its own freshness (versioned URLs + baked data) — never
  // intercept it, so a stale cached copy can't shadow a deployed fix.
  if (url.pathname.includes("/songsnap/")) return;

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
