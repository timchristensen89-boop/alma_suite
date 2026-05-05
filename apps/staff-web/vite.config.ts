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
  server: {
    port: Number(process.env.STAFF_WEB_PORT ?? 5175)
  }
});
