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
        // Split the parts that almost never change away from app code. React,
        // the router and the shared UI kit are identical between deploys, so
        // pulling them into their own chunks means a staff-app release only
        // invalidates the app chunk — a venue on a phone re-downloads what
        // actually changed instead of the whole bundle every time.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: Number(process.env.STAFF_WEB_PORT ?? 5175)
  }
});
