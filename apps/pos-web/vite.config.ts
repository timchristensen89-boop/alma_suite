import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_URL ?? process.env.VITE_API_BASE_URL ?? 'http://localhost:3018';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true }
    }
  }
});
