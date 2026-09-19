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
        // React and the router are identical between deploys. In their own
        // chunk they keep the same hash release after release, so a browser
        // that has them cached (assets are immutable on Hosting) only fetches
        // the app chunk that actually changed.
        manualChunks: { 'react-vendor': ['react', 'react-dom', 'react-router-dom'] }
      }
    }
  },
  server: {
    // Use 5174 so it can run next to the compliance web app (5173).
    port: Number(process.env.STOCK_WEB_PORT ?? 5174)
  }
});
