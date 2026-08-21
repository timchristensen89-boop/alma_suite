import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
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
async function boot() {
  const native = isNative();

  if (native) {
    setTokenPersister((token) => void persistNativeSession(token));
    await restoreNativeSession();
  }

  const Router = native ? HashRouter : BrowserRouter;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Router>
        <App />
      </Router>
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

void boot();
