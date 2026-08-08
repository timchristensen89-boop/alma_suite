import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Kds } from './Kds';
import { Live } from './Live';
import './styles.css';

// #kds turns any tablet into the kitchen display, #live is the owner's
// phone view; everything else is the register.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

const isKds = window.location.hash.includes('kds');
const isLive = window.location.hash.includes('live');
window.addEventListener('hashchange', () => window.location.reload());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isKds ? <Kds /> : isLive ? <Live /> : <App />}</React.StrictMode>
);
