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
}

void boot();
