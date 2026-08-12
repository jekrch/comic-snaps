/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = "panel-images-v1";

/**
 * Cache-first strategy for panel images under the app's base path.
 * Since image filenames are stable (same name = same content),
 * once cached they're served locally until the cache version bumps.
 */

self.addEventListener("install", () => {
  // Activate immediately — no need to wait for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Purge old cache versions on activation.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("panel-images-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  // Only handle same-origin requests under the app's scope.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The path, and not `request.destination`, is what decides. A wall thumbnail
  // is destination "image"; the same bytes asked for by the visualizer's texture
  // pool are a bare `fetch`, whose destination is the empty string — so keying
  // off the destination silently excluded every request the visualizer makes,
  // and each panel it brought up was a round trip to the network however many
  // times it had already been seen. Those round trips are what a turnover was
  // waiting on while the frame sat empty.
  if (!url.pathname.includes("/images/")) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
  );
});