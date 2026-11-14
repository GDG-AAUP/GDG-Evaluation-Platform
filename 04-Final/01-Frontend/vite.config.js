import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standard Vite setup. `base: './'` lets the build be served from any sub-path
// (the app uses hash routing, so no server rewrite rules are needed).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
});
