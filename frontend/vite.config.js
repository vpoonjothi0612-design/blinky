import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/employee-images': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/captured-images': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/unknown-images': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/snapshot-images': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/vehicle-images': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/enrollment-images': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
