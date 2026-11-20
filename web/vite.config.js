import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: '../android/app/src/main/assets/www', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 5000 },
});
