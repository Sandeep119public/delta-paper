import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'icons',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  },
  server: {
    port: 3000,
    open: true
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js']
  }
});
