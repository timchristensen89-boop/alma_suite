import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_URL ?? process.env.VITE_API_BASE_URL ?? 'http://localhost:3018';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React never changes between POS releases; its own chunk means a
        // register release only invalidates the app chunk, so the iPads
        // re-download what actually changed (same rationale as staff-web).
        manualChunks: {
          'react-vendor': ['react', 'react-dom']
        }
      }
    }
  },
  server: {
    port: 5199,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true }
    }
  }
});
