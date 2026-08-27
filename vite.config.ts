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
    minify: 'esbuild',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
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
