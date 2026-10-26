/* Service Worker: macht die App offline verfügbar */
const CACHE = 'geo-water-v4';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'xlsx.js', 'sprache.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // alte App-Versionen löschen, das Sprachmodell (eigener Cache) behalten
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('geo-water-v') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netzwerk zuerst (für Updates). Ohne oder mit schwachem Netz nach spätestens 2.5 s aus dem Cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Spracherkennung und Modell verwaltet sprache.js selbst (eigener, dauerhafter Cache)
  if (url.pathname.includes('/vosk/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    if (!cached) return net;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 2500));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
