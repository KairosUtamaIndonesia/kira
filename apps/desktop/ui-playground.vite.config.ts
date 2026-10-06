import react from '@vitejs/plugin-react';
import stylex from '@stylexjs/rollup-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('./ui-playground', import.meta.url).pathname,
  plugins: [
    stylex({
      dev: true,
      runtimeInjection: true,
    }),
    react(),
  ],
  server: {
    host: '127.0.0.1',
  },
});
