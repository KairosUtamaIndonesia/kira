import { defineConfig } from 'drizzle-kit';
import { DEFAULT_DATABASE_URL } from './src/config';

/**
 * How the statements in `migrations/` are written.
 *
 * Only generation happens from here. The server applies the migrations itself at
 * boot, so a checkout and a deployment run the same statements in the same order
 * without anyone remembering a step in between — which is why there is no
 * `db:migrate` script to forget.
 *
 * A URL is still required by this config, though `generate` never connects to
 * anything: it reads the schema above and writes SQL. It falls back to the
 * development database so the command works with no environment set, the same
 * way the server does.
 */
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.KIRA_DATABASE_URL ?? DEFAULT_DATABASE_URL },
});
