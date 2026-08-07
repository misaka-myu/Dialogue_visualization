import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } } },
  preload: { build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } } },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: { alias: { '@': resolve(__dirname, 'src') } },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'index.html') } } },
    server: { host: '127.0.0.1' },
  }
});
