import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * The bits that only apply when the app is running inside the native shell.
 *
 * Everything here is a no-op on the web build, so one codebase ships both
 * ways and the browser never pays for the native path.
 */
export const isNative = () => Capacitor.isNativePlatform();

const AUTH_TOKEN_KEY = 'alma.staff.session';

/**
 * Make the signed-in session survive being backgrounded for days.
 *
 * A webview's localStorage is not durable — iOS evicts it under storage
 * pressure, and a staff member being logged out between shifts is exactly the
 * friction that gets an app deleted. Preferences is UserDefaults on iOS and
 * SharedPreferences on Android, which the system does not clear.
 *
 * The token is mirrored rather than moved: the API client reads it
 * synchronously from localStorage, and rewriting that to be async would touch
 * every call site for no gain. Preferences is the durable copy, restored into
 * localStorage before the app boots.
 */
export async function restoreNativeSession() {
  if (!isNative()) return;
  try {
    const { value } = await Preferences.get({ key: AUTH_TOKEN_KEY });
    if (value && !window.localStorage.getItem(AUTH_TOKEN_KEY)) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, value);
    }
  } catch {
    // A restore that fails just means signing in again — never a crash on boot.
  }
}

/** Keep the durable copy in step with whatever the API client just wrote. */
export async function persistNativeSession(token: string | null) {
  if (!isNative()) return;
  try {
    if (token) await Preferences.set({ key: AUTH_TOKEN_KEY, value: token });
    else await Preferences.remove({ key: AUTH_TOKEN_KEY });
  } catch {
    // Non-fatal: the session still works for this launch.
  }
}

/**
 * Chrome the shell to match the app, then reveal it.
 *
 * The splash is hidden only after the first render, so nobody sees a white
 * flash between the launch image and the app drawing itself.
 */
export async function initNativeShell() {
  if (!isNative()) return;
  try {
    // Light glyphs, because the app's top edge is the dark forest green.
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#1f3524' });
    }
  } catch {
    // Some devices refuse status bar styling; not worth failing a launch over.
  }
  try {
    await SplashScreen.hide();
  } catch {
    // ditto
  }
}
