/* Service Worker: macht die App offline verfügbar und lädt neue Versionen */
// Der Platzhalter wird beim Veröffentlichen durch Version und Commit ersetzt (tools/release.py)
const CACHE = 'geo-water-app-__APP_CACHE__';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'xlsx.js', 'sprache.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Zwischenspeicher – sonst könnten kurz nach einem Update alte Dateien landen
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // alte App-Versionen löschen, das Sprachmodell (geo-water-sprache) behalten
      .then((keys) => Promise.all(keys
        .filter((k) => (k.startsWith('geo-water-app-') || k.startsWith('geo-water-v')) && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netzwerk zuerst (für Updates). Ohne oder mit schwachem Netz nach spätestens 2.5 s aus dem Cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Spracherkennung und Modell verwaltet sprache.js selbst (eigener, dauerhafter Cache)
  if (url.pathname.includes('/vosk/')) return;
  // Versionsinfo für die Update-Prüfung immer direkt vom Server
  if (url.pathname.endsWith('/version.json')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    // no-cache: beim Server nachfragen, ob sich die Datei geändert hat (günstig dank ETag)
    const net = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    if (!cached) return net;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), 2500));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
