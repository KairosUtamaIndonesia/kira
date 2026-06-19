import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db/postgres";
import { logger } from "@/lib/log";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        let dbOk = false;
        let dbError: string | undefined;

        try {
          await db.execute(sql`SELECT 1`);
          dbOk = true;
        } catch (error: unknown) {
          dbError = error instanceof Error ? error.message : String(error);
          logger.error("health.db_probe_failed", { error: dbError });
        }

        const status: "ok" | "degraded" = dbOk ? "ok" : "degraded";
        const httpStatus = dbOk ? 200 : 503;

        return Response.json(
          {
            status,
            db: dbOk,
            ...(dbError !== undefined && { dbError }),
          },
          { status: httpStatus },
        );
      },
      HEAD: () => {
        return new Response(undefined, { status: 200 });
      },
    },
  },
});
