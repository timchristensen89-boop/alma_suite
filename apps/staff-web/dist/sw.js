/*
 * ALMA Staff service worker.
 *
 * Deliberately minimal: its whole job is to exist so the browser will accept a
 * push subscription, and to put a notification on screen when one arrives.
 * There is no caching here on purpose — the app is served from Firebase
 * Hosting with its own cache headers, and a service worker that also caches is
 * the classic way to leave staff staring at last week's build with no way to
 * force an update from a phone.
 */

// Take over as soon as a new version is installed rather than waiting for
// every tab to close. Staff leave the app open for days.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // A push with no readable body still deserves to show something: a silent
  // failure looks identical to "we never sent it".
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'ALMA Staff';
  const options = {
    body: payload.body || 'Open ALMA Staff to see what changed.',
    icon: '/brand/alma-staff-icon-192.png',
    badge: '/brand/alma-staff-icon-192.png',
    // Same tag replaces an earlier unread one instead of stacking.
    tag: payload.tag || 'alma-staff',
    renotify: true,
    data: { url: payload.url || '/roster' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/roster';

  // Focus a tab that is already open rather than opening a second one — a
  // staff member tapping three notifications should not end up with three
  // copies of the app.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          if ('navigate' in client) client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
