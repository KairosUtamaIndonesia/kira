import react from '@vitejs/plugin-react';
import stylex from '@stylexjs/rollup-plugin';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const stylexOptions = {
  dev: process.env.NODE_ENV === 'development',
  // Vite's dev server does not emit Rollup assets. Inject atomic rules while
  // developing; production emits one static CSS asset instead.
  runtimeInjection: process.env.NODE_ENV === 'development',
};

export default defineConfig({
  // The main process is ESM so it can import ESM-only packages directly.
  // Runtime dependencies stay external: pi alone is a 19 MB dist, which has no
  // business being inlined into the main bundle.
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'es' },
      },
    },
  },
  // The preload stays CommonJS: Electron only supports ESM preload scripts when
  // the renderer is unsandboxed, and this app keeps the sandbox on.
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    optimizeDeps: {
      // Astryx exposes StyleX source through its package exports. Prebundling
      // those entries creates shared chunks that rollup-plugin-stylex can see
      // after Vite has replaced them during dependency re-optimization.
      exclude: ['@astryxdesign/core'],
    },
    plugins: [stylex(stylexOptions), react()],
  },
});
