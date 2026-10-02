import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { schema } from './schema';

/**
 * Kira's database, opened once at boot and shared by everything that reads or
 * writes: Better Auth through its Drizzle adapter, and Kira's own queries.
 *
 * One database holds both halves of Kira's state — the people Better Auth
 * knows about and the rows Kira writes about them. Sharing it is what lets a
 * usage row reference a user (docs/adr/0005-allowances.md), and handing out one
 * connection is what keeps the two halves from being migrated by different
 * callers.
 */
export type Database = ReturnType<typeof openDatabase>;

/** Where the generated statements live: beside the code that describes them. */
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Open a connection to the database at `url`.
 *
 * The return type is left to Drizzle rather than written out, because `drizzle()`
 * is what knows the client is on it — a hand-written `NodePgDatabase` would name
 * the tables and quietly drop the connection underneath them.
 */
export function openDatabase(url: string) {
  return drizzle(new Pool({ connectionString: url }), { schema });
}

/**
 * Bring the database up to date, applying whatever it has not already seen.
 *
 * Every boot does this, including a hot reload and the admin CLI, so a fresh
 * checkout needs no step in between. It is safe to repeat because Drizzle
 * records what it has applied; it is not safe to run twice at once, which is
 * what a second server instance would do. That is the shape Kira runs in
 * today, and it is the thing to fix before there are two of them.
 */
export async function migrate(database: Database): Promise<void> {
  await applyMigrations(database, { migrationsFolder: MIGRATIONS });
}

/**
 * The code Postgres refused with, however many wrappers it arrived in.
 *
 * Drizzle raises its own error and keeps the driver's on `cause`, so the `23505`
 * a unique violation carries is a link or two down rather than on the error that
 * reaches a caller. Reading `.code` off the error itself finds nothing, and a
 * taken name or prefix is then answered as a 500 instead of the refusal the
 * server meant — which is why this walks the chain rather than checking once.
 *
 * It is here rather than in each route because every route that inserts into a
 * table with a unique constraint needs the same answer: tickets and Git
 * connections and skills all tell a conflict from a failure the same way.
 */
export function postgresCode(error: unknown): string | null {
  let at: unknown = error;

  for (let depth = 0; depth < 5 && at !== undefined && at !== null; depth += 1) {
    const code = (at as { code?: unknown }).code;
    if (typeof code === 'string') return code;

    at = (at as { cause?: unknown }).cause;
  }

  return null;
}
