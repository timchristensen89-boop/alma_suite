import { api } from './api.js';

/**
 * Turning roster notifications on and off for this device.
 *
 * Kept free of Capacitor on purpose, the same way api.ts is: this is the web
 * push path, and the web build should not pull a native SDK in to ask a
 * question the browser can answer itself.
 */

export type PushReadiness =
  | { state: 'ready' }
  | { state: 'unsupported'; reason: string }
  | { state: 'needs-install'; reason: string }
  | { state: 'blocked'; reason: string };

/**
 * Is this an iPhone or iPad?
 *
 * iPadOS reports itself as a Mac, so the touch-point check is what catches an
 * iPad — without it, an iPad user gets told notifications are unsupported
 * when in fact they just need to install the app first.
 */
function isApplePhoneOrTablet(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
}

/** Has the app been added to the home screen and opened from there? */
export function isInstalled(): boolean {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  if (standalone === true) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * Why this device can or cannot be switched on, in the order the person needs
 * to hear it. The install requirement comes before the permission state
 * because on iOS there is no permission to grant until the app is installed —
 * asking first just fails silently.
 */
export function pushReadiness(): PushReadiness {
  if (!('serviceWorker' in navigator)) {
    return { state: 'unsupported', reason: 'This browser cannot run background notifications.' };
  }
  if (!('PushManager' in window) || !('Notification' in window)) {
    if (isApplePhoneOrTablet() && !isInstalled()) {
      return {
        state: 'needs-install',
        reason: 'On iPhone and iPad, notifications only work once ALMA Staff is on your home screen.'
      };
    }
    return { state: 'unsupported', reason: 'This browser does not support notifications.' };
  }
  if (isApplePhoneOrTablet() && !isInstalled()) {
    return {
      state: 'needs-install',
      reason: 'On iPhone and iPad, notifications only work once ALMA Staff is on your home screen.'
    };
  }
  if (Notification.permission === 'denied') {
    return {
      state: 'blocked',
      reason: 'Notifications are blocked for this site. Turn them back on in your browser settings.'
    };
  }
  return { state: 'ready' };
}

/**
 * The VAPID key arrives as base64url text and the browser wants raw bytes.
 *
 * Not a formality: pass the string straight through and subscribe() fails with
 * an error that names neither the key nor the encoding.
 */
function applicationServerKey(base64url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  // Built over an explicit ArrayBuffer and handed back as one: a bare
  // Uint8Array is generic over its backing buffer in current lib.dom types
  // and no longer satisfies BufferSource.
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** The endpoint this device is currently subscribed with, if any. */
export async function currentEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

export async function enablePush(publicKey: string): Promise<{ devices: number }> {
  const readiness = pushReadiness();
  if (readiness.state !== 'ready') throw new Error(readiness.reason);
  if (!publicKey) throw new Error('Notifications are not set up on the server yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications were not allowed on this device.');
  }

  const reg = await registration();
  // Reuse an existing subscription rather than minting a second one for the
  // same device — the browser returns the same endpoint anyway, and asking
  // for a new one with a different key throws instead of replacing it.
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey)
    }));

  const body = subscription.toJSON();
  return api<{ devices: number }>('/api/staff/me/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: { endpoint: subscription.endpoint, keys: body.keys }
    })
  });
}

export async function disablePush(): Promise<{ devices: number }> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  const endpoint = subscription?.endpoint;

  // Drop it locally first. If the server call then fails, the device has still
  // stopped receiving — which is what the person just asked for — and the row
  // is pruned on the next send when the push service reports it gone.
  if (subscription) await subscription.unsubscribe().catch(() => undefined);
  if (!endpoint) return { devices: 0 };

  return api<{ devices: number }>('/api/staff/me/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint })
  });
}
