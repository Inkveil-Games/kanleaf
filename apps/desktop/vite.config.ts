import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    // CodeMirror is a lazy, isolated editor chunk; its gzip size stays near 210 kB.
    chunkSizeWarningLimit: 700,
  },
  server: {
    strictPort: true,
  },
});
