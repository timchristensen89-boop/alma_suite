import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_URL ?? process.env.VITE_API_BASE_URL ?? 'http://localhost:3018';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React and the router are identical between deploys. In their own
        // chunk they keep the same hash release after release, so a browser
        // that has them cached (assets are immutable on Hosting) only fetches
        // the app chunk that actually changed.
        manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-router-dom'] }
      }
    }
  },
  server: {
    port: 5198,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
