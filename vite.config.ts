import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],
  server: { 
    port: 3000, 
    open: true 
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.js', 'tests/**/*.vitest.js'],
    setupFiles: ['tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['js/**/*.{ts,js}'],
      exclude: ['node_modules', 'dist'],
    },
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
});
