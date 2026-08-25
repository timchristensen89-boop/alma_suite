import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppErrorBoundary } from './ErrorBoundary';
import './styles.css';

// Error monitoring, opt-in at build time: without VITE_SENTRY_DSN this branch
// compiles out and the Sentry chunk is never downloaded.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  void import('@sentry/react')
    .then((Sentry) => Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE }))
    .catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
