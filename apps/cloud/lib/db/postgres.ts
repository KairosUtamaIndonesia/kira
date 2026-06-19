import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";
import { logger } from "@/lib/log";

import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const schema = { ...authSchema, ...appSchema };

type DatabaseSchema = typeof schema;

// Next.js re-evaluates server modules on every hot reload in development. A
// module-scoped Pool would therefore be rebuilt on each edit, leaking its
// connections until Postgres refuses new ones — which surfaces as the dev
// server stalling. Caching the pool on globalThis keeps a single pool alive
// across reloads. Production evaluates the module once, so it skips the cache.
const globalForDatabase = globalThis as typeof globalThis & { kiraPool?: Pool };

function createPool(): Pool {
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  // An idle pooled client can fail out-of-band (Postgres restart, dropped
  // socket). node-postgres reports this as a pool "error" event; with no
  // listener attached Node escalates it to an uncaught exception and kills the
  // process. The faulted client is already evicted and the next query opens a
  // fresh one, so we surface the error as a warning rather than crash on it.
  pool.on("error", (error) => {
    logger.error("db.pool.error", {
      error: error.message,
      stack: error.stack,
    });
  });

  return pool;
}

const pool = globalForDatabase.kiraPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.kiraPool = pool;
}

const db: NodePgDatabase<DatabaseSchema> = drizzle({ client: pool, schema });

export { db };
