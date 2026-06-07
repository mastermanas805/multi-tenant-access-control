import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The demo SPA (DESIGN §13). Dev server on :5173; the production build is static
// assets served by nginx (see Dockerfile). It talks ONLY to the API Gateway via
// VITE_GATEWAY_URL — no service URLs are ever embedded here.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 8081,
    strictPort: true,
  },
});
