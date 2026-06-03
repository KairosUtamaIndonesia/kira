import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { requireEnvironmentVariable } from "@/lib/env";

import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const schema = { ...authSchema, ...appSchema };

const postgresPool = new Pool({
  connectionString: requireEnvironmentVariable("DATABASE_URL"),
});

const db = drizzle(postgresPool, { schema });

export { db, postgresPool };
