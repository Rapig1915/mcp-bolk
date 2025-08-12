import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4444',
      '/sse': {
        target: 'http://localhost:4444',
        changeOrigin: true,
      },
      '/messages': {
        target: 'http://localhost:4444',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}); 