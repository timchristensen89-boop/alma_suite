import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { AppErrorBoundary } from './ErrorBoundary';
import { setTokenPersister } from './lib/api';
import { initNativeShell, isNative, persistNativeSession, restoreNativeSession } from './lib/native';
import './styles.css';

/**
 * Boot.
 *
 * On the web this is what it always was. Inside the native shell two things
 * differ.
 *
 * Routing uses a hash: the shell serves static files out of the app bundle,
 * so a deep path like /clock has no file behind it and a history router would
 * show a blank screen on any reload or cold start into a route.
 *
 * And the durable session is restored before the first render, so a staff
 * member who last opened the app a week ago is still signed in rather than
 * facing a login screen in a doorway at 6am.
 */
// Error monitoring, opt-in at build time: without VITE_SENTRY_DSN this branch
// compiles out and the Sentry chunk is never downloaded.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  void import('@sentry/react')
    .then((Sentry) => Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE }))
    .catch(() => undefined);
}

async function boot() {
  const native = isNative();

  if (native) {
    setTokenPersister((token) => void persistNativeSession(token));
    await restoreNativeSession();
  }

  const Router = native ? HashRouter : BrowserRouter;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <Router>
          <App />
        </Router>
      </AppErrorBoundary>
    </React.StrictMode>
  );

  // After the first paint, so the splash covers the render instead of handing
  // over to a white screen.
  if (native) {
    requestAnimationFrame(() => void initNativeShell());
  }

  /*
   * Keep the service worker current on the web.
   *
   * Registering here rather than only when somebody turns notifications on
   * means a staff member who subscribed months ago picks up a fixed worker on
   * their next visit. Web only: inside the native shell the app is served from
   * the bundle and push will go through the platform, not this.
   *
   * Failure is silent by design — a browser that refuses to register a worker
   * still runs the whole app, and the notifications card says so in its own
   * words when someone actually tries to switch it on.
   */
  if (!native && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    });
  }
}

// Web only: the native shell serves its chunks from the app bundle, where
// nothing is replaced underneath a running app.
// A deploy replaces every hashed chunk under /assets. A tab opened before the
// deploy still runs the old index.html, so the first lazy route it opens
// afterwards asks for a chunk that no longer exists — and Hosting's SPA
// rewrite answers with index.html instead of JavaScript. Reloading picks up
// the new build. At most one reload a minute, so a genuinely broken network
// cannot bounce the page forever.
if (!isNative()) window.addEventListener('vite:preloadError', (event) => {
  const key = 'alma.chunk-reload-at';
  try {
    const last = Number(window.sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

void boot();
