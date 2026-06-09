import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "@/lib/env";

import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const schema = { ...authSchema, ...appSchema };

type DatabaseSchema = typeof schema;

let database: NodePgDatabase<DatabaseSchema> | undefined;

function getDatabase() {
  if (database === undefined) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    database = drizzle(pool, { schema });
  }

  return database;
}

const db = new Proxy({} as NodePgDatabase<DatabaseSchema>, {
  get(_target, property) {
    const instance = getDatabase();
    const value = Reflect.get(instance, property, instance);

    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { db };
