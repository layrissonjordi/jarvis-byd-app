/* Service worker mínimo: deixa o app abrir offline (casca do app).
   A telemetria em si vem ao vivo pelo MQTT, não é cacheada. */
const CACHE = "jarvisbyd-v1";
const ASSETS = ["./", "index.html", "app.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;         // não intercepta o CDN do mqtt nem o broker
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
