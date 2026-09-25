import react from '@vitejs/plugin-react';
import stylex from '@stylexjs/rollup-plugin';
import { defineConfig } from 'vite';

const stylexOptions = {
  dev: process.env.NODE_ENV === 'development',
  runtimeInjection: process.env.NODE_ENV === 'development',
};

/**
 * Where the console is served. The server hands it out under this path on its own
 * origin, so `/api` on the page and `/api` on the server are one origin and the
 * session cookie is first-party.
 */
const BASE = '/admin/';

/**
 * The dev server's port. Fixed, because the server trusts this one origin for
 * sign-in: a port that moved on its own would stop being the trusted one.
 *
 * Foundry's own number rather than Vite's default — 5173, and so 5174 for whoever
 * got there second. Foundry already holds 4100 for this API, 8317 and 8318 for the
 * model proxy, and 1987 for the desktop's debugging port; a port in Vite's
 * neighbourhood is the one most likely to belong to something else on a machine
 * that runs more than Foundry.
 *
 * `ADMIN_DEV_ORIGIN` in `apps/server/src/auth.ts` is the other half of this number.
 * The two have to agree: the origin is what the server trusts, and it is an origin
 * and not just a host, so the port is part of it.
 */
const PORT = 4101;

/**
 * The server in development — `FOUNDRY_BASE_URL` in `apps/server/.env`. Requests
 * go through here rather than straight to it, so the console talks to one origin
 * in development as it does in production, and no CORS is needed for a setup
 * production would never use.
 */
const SERVER = 'http://localhost:4100';

export default defineConfig({
  base: BASE,
  optimizeDeps: {
    exclude: ['@astryxdesign/core'],
  },
  plugins: [stylex(stylexOptions), react()],
  server: {
    port: PORT,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
    },
  },
});
