// Simpan semua fail apps dalam telefon supaya boleh dibuka tanpa internet.
const VERSION = "v1";
const CORE = [
  "./", "index.html", "app.js", "parse.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png",
  "vendor/tesseract.min.js", "vendor/worker.min.js",
  "vendor/jspdf.umd.min.js", "vendor/jspdf.plugin.autotable.min.js", "vendor/xlsx.full.min.js",
];
const LAZY = ["vendor/core/", "vendor/lang/"]; // fail besar: disimpan bila pertama kali digunakan
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const isLazy = LAZY.some(p => url.pathname.includes(p));
  // Fail apps: cuba rangkaian dahulu (supaya kemas kini sampai), jatuh ke cache bila offline.
  // Fail besar (pembaca teks): cache dahulu.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (isLazy) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
