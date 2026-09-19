import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_URL ?? process.env.VITE_API_BASE_URL ?? 'http://localhost:3018';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React and ReactDOM are identical between deploys. In their own
        // chunk they keep the same hash release after release, so a browser
        // that has them cached (assets are immutable on Hosting) only fetches
        // the app chunk that actually changed.
        manualChunks: { 'react-vendor': ['react', 'react-dom'] }
      }
    }
  },
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
