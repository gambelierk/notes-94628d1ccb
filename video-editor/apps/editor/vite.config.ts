import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  server: {
    port: 5173,
    // API server (apps/server) in development
    proxy: { '/api': 'http://localhost:8787' },
  },
});
