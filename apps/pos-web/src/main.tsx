import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { RegisterErrorBoundary, installGlobalCrashReporting } from './ErrorBoundary';
import './styles.css';
import './theme.css';

installGlobalCrashReporting();

// Error monitoring, opt-in at build time: without VITE_SENTRY_DSN this branch
// compiles out and the Sentry chunk is never downloaded by a till.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  void import('@sentry/react')
    .then((Sentry) => Sentry.init({ dsn: sentryDsn, environment: import.meta.env.MODE }))
    .catch(() => undefined);
}

// #kds turns any tablet into the kitchen display, #live is the owner's
// phone view; everything else is the register.
//
// Every non-register surface is lazy: the routes are mutually exclusive and
// hash changes reload the page, so a till never pays to download the office
// back-office, the board editor, the KDS or the guest menu — they were ~40%
// of the register's chunk.
const Kds = React.lazy(() => import('./Kds').then((m) => ({ default: m.Kds })));
const Live = React.lazy(() => import('./Live').then((m) => ({ default: m.Live })));
const GuestOrder = React.lazy(() => import('./GuestOrder').then((m) => ({ default: m.GuestOrder })));
const QrSheet = React.lazy(() => import('./QrSheet').then((m) => ({ default: m.QrSheet })));
const Office = React.lazy(() => import('./Office').then((m) => ({ default: m.Office })));
const ClockKiosk = React.lazy(() => import('./Clock').then((m) => ({ default: m.Clock })));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

const hash = window.location.hash;
const isKds = hash.includes('kds');
const isLive = hash.includes('live');
const guestToken = hash.startsWith('#o/') ? hash.slice(3) : null;
const isQrSheet = hash === '#qr';
const isOffice = hash === '#office';
const isClock = hash === '#clock';
window.addEventListener('hashchange', () => window.location.reload());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RegisterErrorBoundary>
      <React.Suspense fallback={null}>
        {guestToken ? <GuestOrder token={guestToken} /> : isClock ? <ClockKiosk /> : isOffice ? <Office /> : isQrSheet ? <QrSheet /> : isKds ? <Kds /> : isLive ? <Live /> : <App />}
      </React.Suspense>
    </RegisterErrorBoundary>
  </React.StrictMode>
);
