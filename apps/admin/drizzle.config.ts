import { defineConfig } from "drizzle-kit";

function requireEnvironmentVariable(name: string) {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: requireEnvironmentVariable("DATABASE_URL"),
  },
});
