import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Kds } from './Kds';
import { Live } from './Live';
import { GuestOrder } from './GuestOrder';
import { QrSheet } from './QrSheet';
import './styles.css';
import './theme.css';

// #kds turns any tablet into the kitchen display, #live is the owner's
// phone view; everything else is the register.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

const hash = window.location.hash;
const isKds = hash.includes('kds');
const isLive = hash.includes('live');
const guestToken = hash.startsWith('#o/') ? hash.slice(3) : null;
const isQrSheet = hash === '#qr';
window.addEventListener('hashchange', () => window.location.reload());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {guestToken ? <GuestOrder token={guestToken} /> : isQrSheet ? <QrSheet /> : isKds ? <Kds /> : isLive ? <Live /> : <App />}
  </React.StrictMode>
);
