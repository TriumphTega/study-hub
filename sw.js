// sw.js — service worker: caches the app so it opens offline.
// When you change any file, bump CACHE_VERSION so phones pick up the update.
const CACHE_VERSION = "study-hub-11110952";

const FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "courses/acc101.js",
  "courses/ams101.js",
  "courses/ams103.js",
  "courses/bua101.js",
  "courses/eco101.js",
  "courses/gst111.js",
  "courses/gst121.js",
  "content/ams101.js",
  "content/ams103.js",
  "content/bua101.js",
  "content/eco101.js",
  "content/gst111.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: answer from cache instantly, refresh the cache in the background.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(event.request, { ignoreSearch: true }).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response && response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
