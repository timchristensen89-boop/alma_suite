// ALMA POS service worker — the register must LOAD during an outage, and
// reopen INSTANTLY the rest of the time.
// Assets: cache-first (hashed filenames make staleness impossible).
// Fonts: cache-first (two variable fonts that effectively never change).
// Brand: cache-first. Not hash-named, so a changed icon needs the CACHE bump
//   below to shake loose — worth it, because these are the app's identity and
//   they were the only images that still needed a live network to appear.
// index.html: stale-while-revalidate — the cached shell paints immediately
//   (no round trip to the VPS just to start parsing), and the network copy
//   refreshes the cache in the background. A just-deployed build reaches the
//   register on the next open, or sooner via the app's own update check.
// API calls are never intercepted — the app handles offline itself.
const CACHE = 'alma-pos-shell-v4';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/', '/fonts/Manrope.woff2', '/fonts/CormorantGaramond.woff2']))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // API + external: untouched
  if (event.request.method !== 'GET') return;

  // Hashed assets, fonts and brand marks: cache-first.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/brand/')
  ) {
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

  // ONLY real navigations get the cached shell. This clause previously
  // caught every remaining same-origin GET — images included — and its
  // background refresh wrote whatever came back into the '/' slot, so the
  // register could boot to a cached PNG instead of the app. mode==='navigate'
  // is the actual page load; everything else goes straight to the network.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match('/').then((hit) => {
        const refresh = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put('/', response.clone());
            return response;
          })
          .catch(() => hit);
        return hit ?? refresh;
      })
    )
  );
});
