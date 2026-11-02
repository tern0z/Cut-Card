// Cut Card offline service worker.
// Opens instantly from the on-device copy; when there is a connection it quietly
// refreshes that copy, so an updated index.html shows up on the following launch,
// and tells the open app a new version is ready so it can offer to reload.
// Raising VERSION makes every installed copy fetch all of its files again.
const VERSION = 2, CACHE = 'cutcard-v' + VERSION;
// Drop the saved copies of older versions. Never newer ones: during an update the old worker can still be
// running beside the new one.
const dropOldCaches = () => caches.keys().then((keys) => Promise.all(keys
  .filter((k) => { const m = /^cutcard-v(\d+)$/.exec(k); return m && +m[1] < VERSION; })
  .map((k) => caches.delete(k))));
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
  event.waitUntil(dropOldCaches().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Every page load in the app's folder gets the app itself
  const isPage = req.mode === 'navigate';
  const key = isPage ? INDEX : url.origin + url.pathname;
  // an older worker can save into its copy after this one took over: clear it on the next launch
  if (isPage) event.waitUntil(dropOldCaches().catch(() => {}));

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    // a copy of the app on the device, taken now because the page is given the cached one to read
    const before = cached && key === INDEX ? cached.clone() : null;
    const refresh = fetch(isPage ? new Request(INDEX, { cache: 'no-cache' }) : req)
      .then(async (res) => {
        if (res && res.ok && !res.redirected && res.type === 'basic') {
          // a different app than the one on the device: the open app can offer to reload into it
          const newer = !!before && (await before.text()) !== (await res.clone().text());
          try { await cache.put(key, res.clone()); } catch (e) { return res; /* storage full: keep the copy we have */ }
          if (newer) for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'cutcard-updated' });
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
