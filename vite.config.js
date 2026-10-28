import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://127.0.0.1:4545';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: 'localhost', // YouTube blocks most music embeds on raw-IP origins
    port: 5173,
    proxy: { '/api': api, '/covers': api },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
