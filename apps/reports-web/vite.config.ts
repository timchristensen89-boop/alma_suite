import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@alma/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@alma/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts')
    }
  },
  build: {
    rollupOptions: {
      output: {
        // React and the router are identical between deploys — keeping them in
        // their own chunk means a reports release does not invalidate the
        // framework a browser already has.
        manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-router-dom'] }
      }
    }
  },
  server: {
    port: Number(process.env.REPORTS_WEB_PORT ?? 5176)
  }
});
