const CACHE_NAME = "boy-burger-v4";
const APP_SHELL = [
  "./burger.html",
  "./assets/css/burger.css",
  "./assets/css/burger-history.css",
  "./assets/css/burger-central.css?v=20260904-7",
  "./assets/js/boy-central-config.js",
  "./assets/js/burger.js?v=20260904-6",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("boy-burger-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => {
    if (cached) return cached;
    if (event.request.mode === "navigate") return caches.match("./burger.html");
    return Response.error();
  })));
});
