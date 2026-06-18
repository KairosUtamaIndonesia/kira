/* eslint-disable no-console -- CLI migration script intentionally uses console.error for stderr output */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { Pool } from "pg";
const migrationsFolder = resolve(import.meta.dirname, "drizzle");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle({ client: pool });

console.error(`Running migrations from ${migrationsFolder} ...`);

try {
  await migrate(db, { migrationsFolder });
  console.error("Migrations complete.");
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
} finally {
  await pool.end();
}
