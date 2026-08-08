import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Kds } from './Kds';
import './styles.css';

// #kds turns any tablet into the kitchen display; everything else is the register.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

const isKds = window.location.hash.includes('kds');
window.addEventListener('hashchange', () => window.location.reload());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isKds ? <Kds /> : <App />}</React.StrictMode>
);
