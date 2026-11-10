import { defineConfig } from 'vite';

// base: './' keeps asset URLs relative so the build works from any
// GitHub Pages project subpath without extra configuration.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: '127.0.0.1', port: 5173 },
});
