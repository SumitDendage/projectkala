import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at /admin on the live site. `npm run build` writes it into ../site/admin.
// For `npm run dev`, run the backend locally on :8787 (server/src/local.js); /api is forwarded to it.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: { outDir: '../site/admin', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/fonts': 'http://127.0.0.1:8787' } }
});
