// Cut Card offline service worker.
// Opens instantly from the on-device copy; when there is a connection it quietly
// refreshes that copy, so an updated index.html shows up on the following launch.
const CACHE = 'cutcard-v1';
const INDEX = new URL('./index.html', self.location).href;
const SHELL = [INDEX, './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cutcard-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Every page load in the app's folder gets the app itself
  const isPage = req.mode === 'navigate';
  const key = isPage ? INDEX : url.origin + url.pathname;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    const refresh = fetch(isPage ? new Request(INDEX, { cache: 'no-cache' }) : req)
      .then(async (res) => {
        if (res && res.ok && !res.redirected && res.type === 'basic') {
          try { await cache.put(key, res.clone()); } catch (e) { /* storage full: keep the copy we have */ }
        }
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(refresh);
      return cached;
    }
    const res = await refresh;
    return res || new Response('Cut Card is offline and this file was not saved on the device yet.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })());
});
