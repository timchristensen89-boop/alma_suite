import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// A deploy replaces every hashed chunk under /assets. A tab opened before the
// deploy still runs the old index.html, so the first lazy route it opens
// afterwards asks for a chunk that no longer exists — and Hosting's SPA
// rewrite answers with index.html instead of JavaScript. Reloading picks up
// the new build. At most one reload a minute, so a genuinely broken network
// cannot bounce the page forever.
window.addEventListener('vite:preloadError', (event) => {
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
