// ALMA POS service worker — the register must LOAD during an outage.
// Assets: cache-first (hashed filenames make staleness impossible).
// index.html: network-first with cache fallback.
// API calls are never intercepted — the app handles offline itself.
const CACHE = 'alma-pos-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // API + external: untouched
  if (event.request.method !== 'GET') return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(event.request).then(
          (hit) =>
            hit ??
            fetch(event.request).then((response) => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            })
        )
      )
    );
    return;
  }

  // Navigations: try network, fall back to the cached shell.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE).then((cache) => cache.put('/', response.clone()));
        return response;
      })
      .catch(() => caches.open(CACHE).then((cache) => cache.match('/')))
  );
});
