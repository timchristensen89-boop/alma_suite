import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell around the staff app.
 *
 * The built web app is bundled into the binary rather than pointed at a
 * remote URL. Two reasons: Apple rejects apps that are a thin wrapper around
 * a website, and a bundled app opens instantly on a venue's bad wifi instead
 * of waiting on a download before showing anything.
 *
 * `server.androidScheme: 'https'` keeps the webview on a secure origin, which
 * localStorage, service workers and the offline queue all depend on.
 */
const config: CapacitorConfig = {
  appId: 'au.com.almagroup.staff',
  appName: 'ALMA Staff',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  ios: {
    // The app draws under the status bar; the CSS safe-area insets added in
    // phase 2 are what pad it back.
    contentInset: 'never',
    backgroundColor: '#1f3524'
  },
  android: {
    backgroundColor: '#1f3524'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#1f3524',
      showSpinner: false
    }
  }
};

export default config;
